import { Injectable } from '@nestjs/common';
import { META_PROFILE_STATUS_LABELS, type MetaProfileStatus, type TokenInspection } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { MetaApiError, authStatusFromError } from './graph/meta-errors';

/** A permission error pulls the next token check forward, at most once per this interval. */
const PERMISSION_RECHECK_MS = 15 * 60_000;

/**
 * Single place where a Meta profile's token status changes. Every write is conditional:
 *  - on the current status (`WHERE status = <current>`), so when several workers detect the same expiry at the
 *    same time only one of them wins and exactly one notification is sent;
 *  - on the token fingerprint when the caller passes the one of the token it used (`tokenFingerprint`): a result
 *    for a token that was replaced meanwhile (a job still running with the old token) never touches the new one.
 * A status change and its notification are committed in one transaction, so the alert cannot get lost.
 */
@Injectable()
export class MetaProfileStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
  ) {}

  async applyInspection(profileId: string, inspection: TokenInspection, tokenFingerprint?: string): Promise<void> {
    const status: MetaProfileStatus = inspection.status === 'ERROR' ? 'ERROR' : inspection.status;
    const applied = await this.prisma.metaProfile.updateMany({
      where: { id: profileId, ...(tokenFingerprint ? { tokenFingerprint } : {}) },
      data: {
        lastValidatedAt: new Date(),
        lastValidationError: inspection.valid ? null : inspection.message,
        ...(inspection.valid || inspection.status === 'PERMISSION_REVOKED'
          ? {
              tokenScopes: inspection.scopes,
              tokenType: inspection.tokenType ?? 'UNKNOWN',
              tokenAppId: inspection.appId ?? undefined,
              tokenExpiresAt: inspection.expiresAt ? new Date(inspection.expiresAt) : null,
              dataAccessExpiresAt: inspection.dataAccessExpiresAt ? new Date(inspection.dataAccessExpiresAt) : null,
              metaUserId: inspection.metaUserId ?? undefined,
              metaUserName: inspection.metaUserName ?? undefined,
            }
          : {}),
      },
    });
    if (applied.count !== 1) return; // the token was replaced while it was being inspected
    await this.transition(profileId, status, inspection.message, tokenFingerprint);
  }

  /** Called by any job or request that receives an auth/permission error from Meta for this profile. */
  async onApiError(profileId: string, err: MetaApiError, tokenFingerprint?: string): Promise<void> {
    const forToken = tokenFingerprint ? { tokenFingerprint } : {};
    const status = authStatusFromError(err);
    if (status) {
      const recorded = await this.prisma.metaProfile.updateMany({
        where: { id: profileId, ...forToken },
        data: { lastValidationError: err.details.friendlyMessage, lastErrorCode: err.metaCode ?? null, lastValidatedAt: new Date() },
      });
      if (recorded.count === 1) await this.transition(profileId, status, err.details.friendlyMessage, tokenFingerprint);
      return;
    }
    if (err.category === 'PERMISSION') {
      // Possibly an error about one object only (see authStatusFromError): the token check, which reads the
      // granted permissions, decides whether the token lost its ads access. It runs on the next scheduler tick.
      await this.prisma.metaProfile.updateMany({
        where: {
          id: profileId,
          ...forToken,
          OR: [{ lastValidatedAt: null }, { lastValidatedAt: { lt: new Date(Date.now() - PERMISSION_RECHECK_MS) } }],
        },
        data: { nextTokenCheckAt: new Date() },
      });
    }
  }

  async transition(profileId: string, next: MetaProfileStatus, message: string, tokenFingerprint?: string): Promise<boolean> {
    const current = await this.prisma.metaProfile.findUnique({ where: { id: profileId }, select: { status: true, userId: true, name: true, tokenFingerprint: true } });
    if (!current || current.status === next) return false;
    if (tokenFingerprint && current.tokenFingerprint !== tokenFingerprint) return false;
    const alert = next === 'EXPIRED' || next === 'INVALID' || next === 'PERMISSION_REVOKED';

    const outcome = await this.prisma.$transaction(async (tx) => {
      const res = await tx.metaProfile.updateMany({
        where: { id: profileId, status: current.status, ...(tokenFingerprint ? { tokenFingerprint } : {}) },
        data: { status: next },
      });
      if (res.count !== 1) return null;
      if (!alert) return { pending: null };
      const pending = await this.notifications.notifyInTx(tx, {
        userId: current.userId,
        type: next === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_REVOKED',
        severity: 'ERROR',
        title: `Meta profile "${current.name}": ${META_PROFILE_STATUS_LABELS[next]}`,
        body: message,
        link: `/meta-profiles/${profileId}`,
        dedupeKey: `profile-status:${profileId}:${next}:${Date.now()}`,
        data: { profileId, from: current.status, to: next },
      });
      return { pending };
    });
    if (!outcome) return false;
    if (outcome.pending) await this.notifications.dispatch(outcome.pending);

    await this.audit.log({
      action: 'meta_profile.status_changed',
      actorType: 'SYSTEM',
      subjectUserId: current.userId,
      targetType: 'meta_profile',
      targetId: profileId,
      metadata: { from: current.status, to: next },
    });
    if (alert) {
      await this.activity.record({
        userId: current.userId,
        type: 'TOKEN_STATUS_CHANGED',
        title: `Meta profile "${current.name}" → ${META_PROFILE_STATUS_LABELS[next]}`,
        source: 'SYSTEM',
        details: { profileId, from: current.status, to: next },
      });
    }
    return true;
  }
}

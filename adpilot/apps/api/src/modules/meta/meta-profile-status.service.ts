import { Injectable } from '@nestjs/common';
import { META_PROFILE_STATUS_LABELS, type MetaProfileStatus, type TokenInspection } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { MetaApiError, authStatusFromError } from './graph/meta-errors';

/**
 * Single place where a Meta profile's token status changes. The update is conditional
 * (`WHERE status <> new`), so when several workers detect the same expiry at the same time only one of
 * them wins and exactly one notification is sent.
 */
@Injectable()
export class MetaProfileStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
  ) {}

  async applyInspection(profileId: string, inspection: TokenInspection): Promise<void> {
    const status: MetaProfileStatus = inspection.status === 'ERROR' ? 'ERROR' : inspection.status;
    await this.prisma.metaProfile.update({
      where: { id: profileId },
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
    await this.transition(profileId, status, inspection.message);
  }

  /** Called by any job that receives an auth/permission error from Meta for this profile. */
  async onApiError(profileId: string, err: MetaApiError): Promise<void> {
    const status = authStatusFromError(err);
    if (!status) return;
    await this.prisma.metaProfile.update({
      where: { id: profileId },
      data: { lastValidationError: err.details.friendlyMessage, lastErrorCode: err.metaCode ?? null, lastValidatedAt: new Date() },
    });
    await this.transition(profileId, status, err.details.friendlyMessage);
  }

  async transition(profileId: string, next: MetaProfileStatus, message: string): Promise<boolean> {
    const current = await this.prisma.metaProfile.findUnique({ where: { id: profileId }, select: { status: true, userId: true, name: true } });
    if (!current || current.status === next) return false;
    const res = await this.prisma.metaProfile.updateMany({ where: { id: profileId, status: current.status }, data: { status: next } });
    if (res.count !== 1) return false;

    await this.audit.log({
      action: 'meta_profile.status_changed',
      actorType: 'SYSTEM',
      subjectUserId: current.userId,
      targetType: 'meta_profile',
      targetId: profileId,
      metadata: { from: current.status, to: next },
    });
    if (next === 'EXPIRED' || next === 'INVALID' || next === 'PERMISSION_REVOKED') {
      await this.notifications.notify({
        userId: current.userId,
        type: next === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_REVOKED',
        severity: 'ERROR',
        title: `Meta profile "${current.name}": ${META_PROFILE_STATUS_LABELS[next]}`,
        body: message,
        link: `/meta-profiles/${profileId}`,
        dedupeKey: `profile-status:${profileId}:${next}:${Date.now()}`,
        data: { profileId, from: current.status, to: next },
      });
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

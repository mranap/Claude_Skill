import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { draftSaveSchema, launchRequestSchema, paginationQuerySchema } from '@adpilot/shared';
import { CurrentUser, RateLimit, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { LaunchesService } from './launches.service';
import { DraftsService } from './drafts.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();
const configBody = z.object({ config: z.unknown(), draftId: z.uuid().optional() });

@Controller('launches')
@RequirePermissions('app.campaigns.launch')
export class LaunchesController {
  constructor(private readonly launches: LaunchesService) {}

  /** Local validation only (fast, nothing sent to Meta). */
  @Post('validate')
  @HttpCode(200)
  validate(@CurrentUser() user: AuthUser, @Body(zod(configBody)) body: z.infer<typeof configBody>) {
    return this.launches.validate(user.id, body.config, body.draftId);
  }

  /** Dry run: every object that would be created, with the exact payloads. */
  @Post('dry-run')
  @HttpCode(200)
  @RateLimit({ bucket: 'dry-run', limit: 60, windowSeconds: 600 })
  dryRun(@CurrentUser() user: AuthUser, @Body(zod(configBody)) body: z.infer<typeof configBody>) {
    return this.launches.dryRun(user.id, body.config);
  }

  @Post()
  @HttpCode(202)
  @RateLimit({ bucket: 'launch', limit: 30, windowSeconds: 3600 })
  launch(
    @CurrentUser() user: AuthUser,
    @Body(zod(launchRequestSchema)) body: z.infer<typeof launchRequestSchema>,
  ) {
    return this.launches.launch(user.id, body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(zod(paginationQuerySchema)) q: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.launches.list(user.id, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.launches.get(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.launches.cancel(user.id, id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.launches.retry(user.id, id);
  }
}

const draftListSchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'LAUNCHED', 'ARCHIVED']).optional(),
});

@Controller('drafts')
@RequirePermissions('app.campaigns.launch')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(draftListSchema)) q: z.infer<typeof draftListSchema>) {
    return this.drafts.list(user.id, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.drafts.findOwned(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(zod(draftSaveSchema)) body: z.infer<typeof draftSaveSchema>) {
    return this.drafts.create(user.id, body);
  }

  @Post('from-template/:templateId')
  fromTemplate(@CurrentUser() user: AuthUser, @Param('templateId', uuid) templateId: string) {
    return this.drafts.fromTemplate(user.id, templateId);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(draftSaveSchema)) body: z.infer<typeof draftSaveSchema>,
  ) {
    return this.drafts.update(user.id, id, body);
  }

  @Post(':id/clone')
  clone(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.drafts.clone(user.id, id);
  }

  @Delete(':id')
  async archive(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.drafts.archive(user.id, id);
    return { ok: true };
  }
}

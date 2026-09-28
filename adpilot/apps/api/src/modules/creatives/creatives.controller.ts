import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RateLimit, RequireAnyPermission, RequirePermissions } from '../../common/decorators/auth.decorators';
import { READ_ACCESS } from '../../common/permissions/read-access';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { CreativesService, creativeListQuerySchema, creativeUpdateSchema } from './creatives.service';
import { CreativeUploadService } from './creative-upload.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();

@RequireAnyPermission(...READ_ACCESS.creatives)
@Controller('creatives')
export class CreativesController {
  constructor(
    private readonly creatives: CreativesService,
    private readonly uploads: CreativeUploadService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(creativeListQuerySchema)) q: z.infer<typeof creativeListQuerySchema>) {
    return this.creatives.list(user.id, q);
  }

  @Get('usage')
  usage(@CurrentUser() user: AuthUser) {
    return this.creatives.usage(user.id);
  }

  /** multipart/form-data, one or more `files` parts. Validated and probed server-side. */
  @Post('upload')
  @HttpCode(200)
  @RequirePermissions('app.creatives.manage')
  @RateLimit({ bucket: 'creative-upload', limit: 60, windowSeconds: 3600 })
  upload(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.uploads.handle(req, user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.creatives.get(user.id, id);
  }

  @Patch(':id')
  @RequirePermissions('app.creatives.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(zod(creativeUpdateSchema)) body: z.infer<typeof creativeUpdateSchema>) {
    return this.creatives.update(user.id, id, body);
  }

  @Delete(':id')
  @RequirePermissions('app.creatives.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.creatives.remove(user.id, id);
    return { ok: true };
  }

  /** Pre-upload the creative to an ad account (images → hash, videos → processed video id). */
  @Post(':id/meta-upload')
  @HttpCode(202)
  @RequirePermissions('app.creatives.manage')
  async metaUpload(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(zod(z.object({ adAccountId: z.uuid() }))) body: { adAccountId: string }) {
    await this.creatives.findOwned(user.id, id);
    const asset = await this.creatives.ensureMetaAsset(user.id, id, body.adAccountId);
    return { status: asset.status };
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Headers('range') range: string | undefined, @Res() res: Response) {
    await this.creatives.stream(user.id, id, 'file', range, res);
  }

  @Get(':id/thumbnail')
  async thumbnail(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Res() res: Response) {
    await this.creatives.stream(user.id, id, 'thumbnail', undefined, res);
  }
}

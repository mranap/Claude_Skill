import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { metaConnectionTestSchema, metaProfileCreateSchema, metaProfileUpdateSchema } from '@adpilot/shared';
import { CurrentUser, RateLimit, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MetaProfilesService } from './meta-profiles.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();

@Controller('meta-profiles')
@RequirePermissions('app.meta_profiles.manage')
export class MetaProfilesController {
  constructor(
    private readonly profiles: MetaProfilesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.profiles.list(user.id);
  }

  /** Test token and/or proxy before saving the profile. */
  @Post('test')
  @HttpCode(200)
  @RateLimit({ bucket: 'meta-test', limit: 20, windowSeconds: 600 })
  test(
    @CurrentUser() user: AuthUser,
    @Body(zod(metaConnectionTestSchema)) body: z.infer<typeof metaConnectionTestSchema>,
  ) {
    return this.profiles.testUnsaved(user.id, body);
  }

  @Post()
  @RateLimit({ bucket: 'meta-profile-create', limit: 20, windowSeconds: 3600 })
  create(
    @CurrentUser() user: AuthUser,
    @Body(zod(metaProfileCreateSchema)) body: z.infer<typeof metaProfileCreateSchema>,
  ) {
    return this.profiles.create(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.profiles.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(metaProfileUpdateSchema)) body: z.infer<typeof metaProfileUpdateSchema>,
  ) {
    return this.profiles.update(user.id, id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.profiles.remove(user.id, id);
    return { ok: true };
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RateLimit({ bucket: 'meta-validate', limit: 20, windowSeconds: 600 })
  validate(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.profiles.validate(user.id, id);
  }

  @Post(':id/test-proxy')
  @HttpCode(200)
  @RateLimit({ bucket: 'meta-test-proxy', limit: 20, windowSeconds: 600 })
  testProxy(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.profiles.testProxy(user.id, id);
  }

  @Post(':id/sync')
  @HttpCode(202)
  @RateLimit({ bucket: 'meta-sync', limit: 10, windowSeconds: 600 })
  sync(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.profiles.requestSync(user.id, id, 'manual');
  }

  /** Discovered assets of a profile: businesses, ad accounts (connected or not) and pages. */
  @Get(':id/assets')
  async assets(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.profiles.findOwned(user.id, id);
    const [businesses, adAccounts, pages] = await Promise.all([
      this.prisma.businessAccount.findMany({
        where: { profileId: id, userId: user.id },
        orderBy: { name: 'asc' },
      }),
      this.prisma.adAccount.findMany({
        where: { profileId: id, userId: user.id },
        orderBy: [{ isConnected: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          metaAccountId: true,
          name: true,
          currency: true,
          timezoneName: true,
          statusKey: true,
          accountStatus: true,
          isConnected: true,
          metaBusinessId: true,
          metaBusinessName: true,
        },
      }),
      this.prisma.page.findMany({ where: { profileId: id, userId: user.id }, orderBy: { name: 'asc' } }),
    ]);
    return { businesses, adAccounts, pages };
  }
}

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
import {
  ruleCreateSchema,
  ruleExecutionsQuerySchema,
  ruleListQuerySchema,
  ruleUpdateSchema,
} from '@adpilot/shared';
import { CurrentUser, RateLimit, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { RulesService } from './rules.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();

@Controller('rules')
@RequirePermissions('app.rules.manage')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(zod(ruleListQuerySchema)) q: z.infer<typeof ruleListQuerySchema>,
  ) {
    return this.rules.list(user.id, q);
  }

  @Get('executions')
  executions(
    @CurrentUser() user: AuthUser,
    @Query(zod(ruleExecutionsQuerySchema)) q: z.infer<typeof ruleExecutionsQuerySchema>,
  ) {
    return this.rules.executions(user.id, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.rules.get(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(zod(ruleCreateSchema)) body: z.infer<typeof ruleCreateSchema>) {
    return this.rules.create(user.id, body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(ruleUpdateSchema)) body: z.infer<typeof ruleUpdateSchema>,
  ) {
    return this.rules.update(user.id, id, body);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.rules.setActive(user.id, id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.rules.setActive(user.id, id, false);
  }

  @Post(':id/run')
  @HttpCode(202)
  @RateLimit({ bucket: 'rule-run', limit: 10, windowSeconds: 600 })
  run(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.rules.runNow(user.id, id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.rules.remove(user.id, id);
    return { ok: true };
  }
}

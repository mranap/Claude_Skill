import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DeliveryService } from './delivery.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, DeliveryService],
  exports: [NotificationsService, DeliveryService],
})
export class NotificationsModule {}

import { Global, Module } from '@nestjs/common';
import { CreativesController } from './creatives.controller';
import { CreativesService } from './creatives.service';
import { CreativeUploadService } from './creative-upload.service';
import { MediaProbeService } from './media-probe.service';
import { MetaMediaService } from './meta-media.service';

@Global()
@Module({
  controllers: [CreativesController],
  providers: [CreativesService, CreativeUploadService, MediaProbeService, MetaMediaService],
  exports: [CreativesService, MetaMediaService, MediaProbeService],
})
export class CreativesModule {}

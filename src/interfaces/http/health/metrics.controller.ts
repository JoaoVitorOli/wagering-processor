import { Controller, Get, Header, Inject } from '@nestjs/common';
import { METRICS, type Metrics } from '../../../infra/observability/metrics.js';

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS) private readonly metrics: Metrics) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}

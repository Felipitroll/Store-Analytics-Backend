import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get(':storeId')
    getAnalytics(
        @Param('storeId') storeId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('comparisonPeriod') comparisonPeriod?: 'previous_period' | 'last_month' | 'last_year',
    ) {
        return this.analyticsService.getStoreAnalytics(storeId, startDate, endDate, comparisonPeriod);
    }

    @Get(':storeId/sessions')
    getSessionMetrics(
        @Param('storeId') storeId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.analyticsService.getSessionMetrics(storeId, startDate, endDate);
    }
}

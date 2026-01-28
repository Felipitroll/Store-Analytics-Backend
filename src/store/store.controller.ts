import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { StoreService } from './store.service';

@Controller('stores')
export class StoreController {
    constructor(private readonly storeService: StoreService) { }

    @Post()
    create(@Body() body: { url: string; accessToken: string; name: string; tags?: string[]; startDate?: string; endDate?: string }) {
        return this.storeService.create(body.url, body.accessToken, body.name, body.tags, body.startDate, body.endDate);
    }

    @Get()
    findAll() {
        return this.storeService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.storeService.findOne(id);
    }

    @Post(':id/sync')
    async sync(@Param('id') id: string) {
        try {
            const store = await this.storeService.findOne(id);
            await this.storeService.syncStoreData(store);
            return { success: true, message: 'Sync completed successfully' };
        } catch (error: any) {
            return { success: false, message: error.message || 'Sync failed' };
        }
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.storeService.remove(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() body: { name?: string; accessToken?: string; startDate?: Date; endDate?: Date; tags?: string[] }) {
        return this.storeService.update(id, body);
    }
}

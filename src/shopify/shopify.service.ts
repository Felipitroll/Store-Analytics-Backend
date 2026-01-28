import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ShopifyService {
    private readonly logger = new Logger(ShopifyService.name);

    constructor(private readonly httpService: HttpService) { }

    private formatStoreUrl(storeUrl: string): string {
        let url = storeUrl.trim();
        // Remove protocol to check for domain validity
        const noProtocol = url.replace(/^https?:\/\//, '');

        // If no dot, assume it's a store name and append .myshopify.com
        if (!noProtocol.includes('.')) {
            return `https://${noProtocol}.myshopify.com`;
        }

        // Ensure protocol is present
        return url.startsWith('http') ? url : `https://${url}`;
    }

    private async executeGraphQL(storeUrl: string, accessToken: string, query: string): Promise<any> {
        const baseUrl = this.formatStoreUrl(storeUrl);
        // Use 2026-01 version to match REST API and ensure compatibility
        const url = `${baseUrl}/admin/api/2026-01/graphql.json`;

        try {
            const { data } = await firstValueFrom(
                this.httpService.post(url, { query }, {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json; charset=utf-8',
                        'Accept': 'application/json',
                    },
                }),
            );

            if (data.errors) {
                // Check if it's a "Field doesn't exist" error (ShopifyQL not supported)
                const isUndefinedField = data.errors.some((e: any) => e.extensions?.code === 'undefinedField');

                if (isUndefinedField) {
                    this.logger.warn(`ShopifyQL not supported by this store/API version: ${JSON.stringify(data.errors[0].message)}`);
                    return { shopifyqlQuery: { tableData: { rows: [] } } }; // Return empty structure
                }

                this.logger.error('GraphQL errors:', JSON.stringify(data.errors));
                throw new Error(`GraphQL Error: ${JSON.stringify(data.errors)}`);
            }

            return data.data;
        } catch (error) {
            this.logger.error(`Failed to execute GraphQL query on ${baseUrl}`, error.response?.data || error.message);
            throw new Error(`Shopify GraphQL Error: ${error.message}`);
        }
    }

    async getDailyAnalytics(storeUrl: string, accessToken: string, since: string, until: string) {
        // ShopifyQL query
        const shopifyQLQuery = `FROM sales, sessions SHOW day, total_sales, orders, average_order_value, conversion_rate, sessions GROUP BY day SINCE ${since} UNTIL ${until} ORDER BY day ASC`;

        const query = `
            query getDailyAnalytics {
                shopifyqlQuery(
                    query: """${shopifyQLQuery}"""
                ) {
                    tableData {
                        columns {
                            name
                            dataType
                        }
                        rows
                    }
                    parseErrors
                }
            }
        `;

        this.logger.log(`ShopifyQL Query: ${shopifyQLQuery}`);

        try {
            const result = await this.executeGraphQL(storeUrl, accessToken, query);

            if (result.shopifyqlQuery?.parseErrors && result.shopifyqlQuery.parseErrors.length > 0) {
                const errors = result.shopifyqlQuery.parseErrors;
                this.logger.error('ShopifyQL parse errors:', JSON.stringify(errors));
                const errorDetail = typeof errors[0] === 'string' ? errors[0] : (errors[0].message || JSON.stringify(errors[0]));
                throw new Error(`ShopifyQL Error: ${errorDetail}`);
            }

            const tableData = result.shopifyqlQuery?.tableData;
            if (!tableData || !tableData.rows) {
                this.logger.warn('No analytics data returned from ShopifyQL');
                return [];
            }

            this.logger.log(`Fetched ${tableData.rows.length} rows from ShopifyQL`);

            // Parse the rows
            // Expected columns from query: total_sales, orders, average_order_value, conversion_rate, sessions, day
            // Note: "day" is usually the grouping key, so it might be first or last depending on ShopifyQL implementation details.
            // Usually GROUP BY columns appear first in result rows, OR the order matches SHOW + GROUP BY.
            // Let's verify column order or map by index dynamically if possible, but for now we assume the order returned matches SHOW unless GROUP BY key is implicit.
            // Actually, ShopifyQL returns GROUP BY keys first.
            // So: day, total_sales, orders, average_order_value, conversion_rate, sessions

            return tableData.rows.map((row: any) => {
                const isArray = Array.isArray(row);
                return {
                    date: isArray ? row[0] : row.day,
                    totalSales: parseFloat((isArray ? row[1] : row.total_sales) || '0'),
                    orders: parseInt((isArray ? row[2] : row.orders) || '0'),
                    averageOrderValue: parseFloat((isArray ? row[3] : row.average_order_value) || '0'),
                    conversionRate: parseFloat((isArray ? row[4] : row.conversion_rate) || '0'),
                    sessions: parseInt((isArray ? row[5] : row.sessions) || '0'),
                };
            });

        } catch (error) {
            this.logger.error(`Failed to fetch daily analytics`, error.message);
            throw error;
        }
    }

    async getProductAnalytics(storeUrl: string, accessToken: string, since: string, until: string) {
        // ShopifyQL query
        const shopifyQLQuery = `FROM sales SHOW day, product_title, total_sales, net_sales, net_items_sold GROUP BY day, product_title SINCE ${since} UNTIL ${until} ORDER BY day ASC`;

        const query = `
            query getProductAnalytics {
                shopifyqlQuery(
                    query: """${shopifyQLQuery}"""
                ) {
                    tableData {
                        columns {
                            name
                            dataType
                        }
                        rows
                    }
                    parseErrors
                }
            }
        `;

        this.logger.log(`ShopifyQL Product Query: ${shopifyQLQuery}`);

        try {
            const result = await this.executeGraphQL(storeUrl, accessToken, query);

            if (result.shopifyqlQuery?.parseErrors && result.shopifyqlQuery.parseErrors.length > 0) {
                const errors = result.shopifyqlQuery.parseErrors;
                this.logger.error('ShopifyQL parse errors:', JSON.stringify(errors));
                const errorDetail = typeof errors[0] === 'string' ? errors[0] : (errors[0].message || JSON.stringify(errors[0]));
                throw new Error(`ShopifyQL Error: ${errorDetail}`);
            }

            const tableData = result.shopifyqlQuery?.tableData;
            if (!tableData || !tableData.rows) {
                this.logger.warn('No product analytics data returned from ShopifyQL');
                return [];
            }

            this.logger.log(`Fetched ${tableData.rows.length} product rows from ShopifyQL`);

            // Parse rows. Expected order based on query:
            // day, product_title, total_sales, net_sales, net_items_sold
            // (Group keys usually come first)

            return tableData.rows.map((row: any) => {
                const isArray = Array.isArray(row);
                return {
                    date: isArray ? row[0] : row.day,
                    productTitle: isArray ? row[1] : row.product_title,
                    totalSales: parseFloat((isArray ? row[2] : row.total_sales) || '0'),
                    netSales: parseFloat((isArray ? row[3] : row.net_sales) || '0'),
                    netItemsSold: parseInt((isArray ? row[4] : row.net_items_sold) || '0'),
                };
            });

        } catch (error) {
            this.logger.error(`Failed to fetch product analytics`, error.message);
            throw error;
        }
    }

    async getOrders(storeUrl: string, accessToken: string) {
        const baseUrl = this.formatStoreUrl(storeUrl);
        const url = `${baseUrl}/admin/api/2026-01/orders.json?status=any&limit=250`;

        try {
            const { data } = await firstValueFrom(
                this.httpService.get(url, {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json; charset=utf-8',
                        'Accept': 'application/json',
                    },
                }),
            );
            return data.orders;
        } catch (error) {
            this.logger.error(`Failed to fetch orders from ${baseUrl}`, error.response?.data || error.message);
            throw new Error(`Shopify API Error: ${error.message}`);
        }
    }

    async getProducts(storeUrl: string, accessToken: string) {
        const baseUrl = this.formatStoreUrl(storeUrl);
        const url = `${baseUrl}/admin/api/2026-01/products.json?limit=250`;

        try {
            const { data } = await firstValueFrom(
                this.httpService.get(url, {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json; charset=utf-8',
                        'Accept': 'application/json',
                    },
                }),
            );
            return data.products;
        } catch (error) {
            this.logger.error(`Failed to fetch products from ${baseUrl}`, error.response?.data || error.message);
            throw new Error(`Shopify API Error: ${error.message}`);
        }
    }
}

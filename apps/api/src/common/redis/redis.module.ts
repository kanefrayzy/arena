import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Redis');
  private _client: Redis | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL ?? 'redis://redis:6379';
    this._client = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    this._client.on('error', (e) => this.log.error(`redis error: ${e.message}`));
    await this._client.connect();
    this.log.log(`connected to ${url}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this._client?.quit().catch(() => undefined);
  }

  get client(): Redis {
    if (!this._client) throw new Error('redis not initialized');
    return this._client;
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}

import { resolve } from 'node:path';
import { getBloggerConfig } from '../config/env.ts';
import { JsonFileLedger, type PublishLedger } from '../storage/publish-ledger.ts';
import type { BlogPublisher } from './adapters/publisher-interface.ts';
import { BloggerApi } from './blogger/blogger-api.ts';
import { BloggerAuth } from './blogger/blogger-auth.ts';
import { BloggerPublisher } from './blogger/blogger-publisher.ts';

/**
 * 발행 플랫폼 선택 지점. 파이프라인은 이 함수만 알고, 플랫폼 세부사항은 모른다.
 * 향후 'wordpress' | 'tistory' 등을 여기에 추가한다.
 */
export type PlatformName = 'blogger';

export function createPublisher(
  platform: PlatformName = 'blogger',
  opts: { ledger?: PublishLedger; log?: (m: string) => void } = {},
): BlogPublisher {
  switch (platform) {
    case 'blogger': {
      const cfg = getBloggerConfig();
      const auth = new BloggerAuth(cfg);
      return new BloggerPublisher({
        blogId: cfg.blogId,
        api: new BloggerApi(auth),
        ledger: opts.ledger ?? new JsonFileLedger(resolve('data/ledger/publish-ledger.json')),
        log: opts.log ?? ((m) => console.log(`[blogger] ${m}`)),
      });
    }
    default:
      throw new Error(`지원하지 않는 플랫폼: ${platform satisfies never}`);
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { MediaSlots } from '../content/html-builder.ts';
import type { BlogImage, BlogVideo } from '../types/content.ts';
import type { ArticleDraft } from '../types/draft.ts';
import { generateInfographics } from './image-engine.ts';
import type { MediaHost } from './media-host.ts';
import { generateVideo } from './video-generator.ts';

/**
 * 미디어 단계 전체: 이미지 생성 → 영상 생성 → 호스팅 업로드 → 매니페스트 저장.
 * 텍스트 생성과 분리되어 있어 미디어가 실패해도 원고는 그대로 남는다.
 */

export interface MediaManifest {
  contentId: string;
  generatedAt: string;
  host: string;
  images: BlogImage[];
  video?: BlogVideo;
  errors: string[];
}

export function slugOf(d: ArticleDraft): string {
  return d.slug ?? `post-${d.contentId}`;
}

export async function buildMedia(d: ArticleDraft, o: { outDir: string; host: MediaHost; remotePrefix?: string; retries?: number }): Promise<{ slots: MediaSlots; manifest: MediaManifest }> {
  const mediaDir = join(o.outDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const slug = slugOf(d);
  const errors: string[] = [];
  const remote = (file: string) => `${o.remotePrefix ?? `media/${d.date.slice(0, 4)}/${d.date.slice(5, 7)}/${d.contentId}`}/${basename(file)}`;
  const retries = o.retries ?? 3;

  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    for (let i = 1; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        errors.push(`${label} 실패 (${i}/${retries}): ${(e as Error).message}`);
      }
    }
    return undefined;
  };

  const images = (await attempt('이미지 생성', () => generateInfographics(d.media?.images ?? [], { date: d.date, slug, outDir: mediaDir }))) ?? [];
  for (const img of images) {
    img.publicUrl = await attempt(`업로드 ${basename(img.localPath)}`, () => o.host.upload(img.localPath, remote(img.localPath)));
  }

  let video: BlogVideo | undefined;
  if (d.media?.video) {
    video = await attempt('영상 생성', () => generateVideo(d.media!.video!, { date: d.date, slug, outDir: mediaDir }));
    if (video) {
      video.publicUrl = await attempt('영상 업로드', () => o.host.upload(video!.localPath, remote(video!.localPath)));
      if (video.posterPath) video.posterUrl = await attempt('포스터 업로드', () => o.host.upload(video!.posterPath!, remote(video!.posterPath!)));
    }
  }

  const manifest: MediaManifest = { contentId: d.contentId, generatedAt: new Date().toISOString(), host: o.host.name, images, video, errors };
  await writeFile(join(mediaDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { slots: { images, video }, manifest };
}

import type { ImgHTMLAttributes } from 'react';

type LocalImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> & {
  asset: string;
  alt: string;
  priority?: boolean;
};

const base = '/assets/images/';

export default function LocalImage({ asset, alt, priority = false, className, ...imgProps }: LocalImageProps) {
  return (
    <picture className={className}>
      <source media="(max-width: 640px)" srcSet={`${base}${asset}-mobile.avif`} type="image/avif" />
      <source media="(max-width: 640px)" srcSet={`${base}${asset}-mobile.webp`} type="image/webp" />
      <source srcSet={`${base}${asset}-desktop.avif`} type="image/avif" />
      <source srcSet={`${base}${asset}-desktop.webp`} type="image/webp" />
      <img
        src={`${base}${asset}-desktop.webp`}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        {...imgProps}
      />
    </picture>
  );
}

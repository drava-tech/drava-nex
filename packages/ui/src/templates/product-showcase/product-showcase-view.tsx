// Presentational Product Showcase. Pure: it receives already-fetched product
// data + the display toggles and renders them at the 1920×1080 design size. It
// performs NO data fetching and hard-codes NO product content. The lower content
// column scrolls internally so long specs/features work on touchscreens while a
// TV (which usually fits) shows no scrollbar.

import type { ProductDisplayData } from "@platform/types";
import type { ProductShowcaseContent } from "./content";

interface ProductShowcaseViewProps {
  product: ProductDisplayData;
  config: ProductShowcaseContent;
}

function HeroPane({ product, config }: ProductShowcaseViewProps) {
  const showVideo = config.showVideo && product.video?.url;
  const heroImage = product.hero?.url ?? product.thumbnail?.url ?? null;

  return (
    <div className="relative h-full w-[46%] shrink-0 overflow-hidden bg-zinc-900">
      {showVideo ? (
        <video
          src={product.video!.url}
          autoPlay
          muted
          loop
          playsInline
          className="h-full w-full object-cover"
        />
      ) : heroImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroImage}
          alt={product.hero?.altText ?? product.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-[160px] font-bold text-zinc-700">
            {product.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
    </div>
  );
}

function FeatureCards({ product }: { product: ProductDisplayData }) {
  if (product.features.length === 0) return null;
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-[30px] font-semibold text-white">Features</h2>
      <div className="grid grid-cols-2 gap-5">
        {product.features.map((f) => (
          <div
            key={f.id}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6"
          >
            <p className="text-[24px] font-semibold text-white">{f.title}</p>
            {f.description ? (
              <p className="mt-2 text-[19px] leading-snug text-zinc-400">{f.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function DescriptionBlock({ product }: { product: ProductDisplayData }) {
  if (!product.fullDescription) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[30px] font-semibold text-white">About</h2>
      <p className="whitespace-pre-line text-[24px] leading-snug text-zinc-300">
        {product.fullDescription}
      </p>
    </section>
  );
}

function ProductDetails({ product }: { product: ProductDisplayData }) {
  const details = [
    ["SKU", product.sku],
    ["Detection label", product.detectionLabel],
    ["Status", product.status],
    ["Slug", product.slug],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  if (details.length === 0) return null;

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-[30px] font-semibold text-white">Product details</h2>
      <dl className="grid grid-cols-2 gap-4">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <dt className="text-[18px] font-medium uppercase tracking-wide text-zinc-500">
              {label}
            </dt>
            <dd className="mt-2 break-words text-[24px] font-semibold text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SpecificationGroups({ product }: { product: ProductDisplayData }) {
  if (product.specificationGroups.length === 0) return null;
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-[30px] font-semibold text-white">Specifications</h2>
      <div className="flex flex-col gap-6">
        {product.specificationGroups.map((group) => (
          <div key={group.name} className="flex flex-col gap-3">
            <p className="text-[22px] font-medium uppercase tracking-wide text-zinc-500">
              {group.name}
            </p>
            <dl className="overflow-hidden rounded-2xl border border-zinc-800">
              {group.items.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-baseline justify-between gap-6 px-6 py-4 ${
                    i % 2 === 0 ? "bg-zinc-900/40" : "bg-transparent"
                  }`}
                >
                  <dt className="text-[21px] text-zinc-400">{item.label}</dt>
                  <dd className="text-right text-[21px] font-medium text-white">
                    {item.value}
                    {item.unit ? <span className="ml-1 text-zinc-400">{item.unit}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function Gallery({ product }: { product: ProductDisplayData }) {
  if (product.gallery.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[30px] font-semibold text-white">Gallery</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {product.gallery.map((g) => (
          <div
            key={g.id}
            className="h-[150px] w-[230px] shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
          >
            {g.type === "video" ? (
              <video src={g.url} muted playsInline className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.url}
                alt={g.altText ?? product.name}
                className="h-full w-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProductShowcaseView({ product, config }: ProductShowcaseViewProps) {
  const meta = [product.brand, product.category].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full w-full bg-zinc-950 font-sans text-white">
      {config.showHero ? <HeroPane product={product} config={config} /> : null}

      <div className="flex min-w-0 flex-1 flex-col gap-8 p-16">
        <header className="flex flex-col gap-3">
          {meta ? (
            <p className="text-[24px] font-medium uppercase tracking-[0.2em] text-zinc-500">
              {meta}
            </p>
          ) : null}
          <h1 className="line-clamp-2 text-[64px] font-bold leading-[1.05]">{product.name}</h1>
          {product.shortDescription ? (
            <p className="line-clamp-3 text-[28px] leading-snug text-zinc-300">
              {product.shortDescription}
            </p>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto pr-2">
          <DescriptionBlock product={product} />
          {config.showFeatures ? <FeatureCards product={product} /> : null}
          <ProductDetails product={product} />
          {config.showSpecifications ? <SpecificationGroups product={product} /> : null}
          {config.showGallery ? <Gallery product={product} /> : null}
        </div>
      </div>
    </div>
  );
}

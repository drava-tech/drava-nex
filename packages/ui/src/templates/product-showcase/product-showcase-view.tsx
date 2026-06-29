import { CreditCard, PackageCheck, ShoppingCart, ShieldCheck, Star, Truck } from "lucide-react";
import type { ProductDisplayData, ProductMediaRef } from "@platform/types";
import type { ProductShowcaseContent } from "./content";

interface ProductShowcaseViewProps {
  product: ProductDisplayData;
  config: ProductShowcaseContent;
}

function getPrimaryMedia(product: ProductDisplayData, config: ProductShowcaseContent) {
  if (config.showVideo && product.video?.url) return product.video;
  return product.hero ?? product.thumbnail ?? product.gallery[0] ?? null;
}

function ProductMedia({
  product,
  config,
}: {
  product: ProductDisplayData;
  config: ProductShowcaseContent;
}) {
  const primary = getPrimaryMedia(product, config);
  const thumbnails = [
    product.hero,
    product.thumbnail,
    ...(config.showGallery ? product.gallery : []),
  ].filter((item, index, all): item is ProductMediaRef => {
    if (!item) return false;
    return all.findIndex((candidate) => candidate?.id === item.id) === index;
  });

  if (!config.showHero) return null;

  return (
    <section className="flex h-full min-w-0 flex-[0_0_42%] flex-col gap-6 bg-[#f7f7f4] p-10">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[6px] border border-[#e5e1d8] bg-white">
        {primary ? (
          primary.type === "video" ? (
            <video
              src={primary.url}
              autoPlay
              muted
              loop
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={primary.url}
              alt={primary.altText ?? product.name}
              className="h-full w-full object-contain p-8"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#ededeb]">
            <span className="text-[180px] font-black text-[#bbb7ae]">
              {product.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        <div className="absolute left-6 top-6 rounded-[4px] bg-[#111827] px-4 py-2 text-[18px] font-bold uppercase tracking-[0.08em] text-white">
          Featured
        </div>
      </div>

      {thumbnails.length > 1 ? (
        <div className="grid h-[128px] grid-cols-4 gap-4">
          {thumbnails.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="overflow-hidden rounded-[6px] border border-[#e5e1d8] bg-white"
            >
              {item.type === "video" ? (
                <video src={item.url} muted playsInline className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt={item.altText ?? product.name}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RatingLine() {
  return (
    <div className="flex items-center gap-3 text-[22px]">
      <div className="flex items-center gap-1 text-[#f5a524]" aria-hidden>
        {Array.from({ length: 5 }).map((_, index) => (
          <Star key={index} className="h-6 w-6 fill-current" />
        ))}
      </div>
      <span className="font-semibold text-[#1f2937]">4.8</span>
      <span className="text-[#6b7280]">Trusted product pick</span>
    </div>
  );
}

function ProductSummary({ product }: { product: ProductDisplayData }) {
  const meta = [product.brand, product.category].filter(Boolean).join(" / ");

  return (
    <header className="flex flex-col gap-5">
      {meta ? (
        <p className="text-[20px] font-bold uppercase tracking-[0.16em] text-[#6b7280]">
          {meta}
        </p>
      ) : null}
      <h1 className="line-clamp-2 text-[72px] font-black leading-[0.98] text-[#101827]">
        {product.name}
      </h1>
      <RatingLine />
      {product.shortDescription ? (
        <p className="line-clamp-4 max-w-[760px] text-[30px] leading-[1.24] text-[#4b5563]">
          {product.shortDescription}
        </p>
      ) : null}
    </header>
  );
}

function BuyPanel({ product }: { product: ProductDisplayData }) {
  const detailItems = [
    ["Status", product.status === "ACTIVE" ? "In stock" : product.status],
    ["SKU", product.sku],
    ["Product ID", product.id],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <aside className="flex h-full w-[390px] shrink-0 flex-col border-l border-[#e7e2d8] bg-white px-8 py-10">
      <div className="flex flex-col gap-2">
        <span className="text-[19px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
          Price
        </span>
        <p className="text-[52px] font-black leading-none text-[#101827]">Request price</p>
        <p className="text-[20px] leading-snug text-[#6b7280]">
          Scan, explore, then continue with checkout support.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-4">
        <button className="flex h-[74px] items-center justify-center gap-3 rounded-[6px] bg-[#111827] px-6 text-[24px] font-black text-white shadow-lg shadow-black/15">
          <ShoppingCart className="h-8 w-8" />
          Add to cart
        </button>
        <button className="flex h-[74px] items-center justify-center gap-3 rounded-[6px] border-2 border-[#111827] bg-white px-6 text-[24px] font-black text-[#111827]">
          <CreditCard className="h-8 w-8" />
          Buy now
        </button>
      </div>

      <div className="mt-8 grid grid-cols-3 overflow-hidden rounded-[6px] border border-[#e7e2d8] text-center">
        <div className="flex flex-col items-center gap-2 border-r border-[#e7e2d8] px-3 py-5">
          <Truck className="h-7 w-7 text-[#0f766e]" />
          <span className="text-[15px] font-bold leading-tight text-[#374151]">Fast delivery</span>
        </div>
        <div className="flex flex-col items-center gap-2 border-r border-[#e7e2d8] px-3 py-5">
          <ShieldCheck className="h-7 w-7 text-[#0f766e]" />
          <span className="text-[15px] font-bold leading-tight text-[#374151]">Secure buy</span>
        </div>
        <div className="flex flex-col items-center gap-2 px-3 py-5">
          <PackageCheck className="h-7 w-7 text-[#0f766e]" />
          <span className="text-[15px] font-bold leading-tight text-[#374151]">Pickup ready</span>
        </div>
      </div>

      {detailItems.length > 0 ? (
        <dl className="mt-8 flex flex-col divide-y divide-[#ebe7df] border-y border-[#ebe7df]">
          {detailItems.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-5 py-4">
              <dt className="text-[18px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                {label}
              </dt>
              <dd className="max-w-[210px] break-words text-right text-[20px] font-bold text-[#111827]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-auto rounded-[6px] bg-[#f4f6f8] p-5 text-[18px] leading-snug text-[#4b5563]">
        <strong className="block text-[20px] text-[#111827]">Need help?</strong>
        Ask a store associate for availability, variants, or checkout assistance.
      </div>
    </aside>
  );
}

function DescriptionBlock({ product }: { product: ProductDisplayData }) {
  if (!product.fullDescription) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[28px] font-black text-[#101827]">About this product</h2>
      <p className="max-h-[190px] overflow-y-auto whitespace-pre-line pr-2 text-[23px] leading-[1.36] text-[#4b5563]">
        {product.fullDescription}
      </p>
    </section>
  );
}

function FeatureList({ product }: { product: ProductDisplayData }) {
  if (product.features.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[28px] font-black text-[#101827]">Highlights</h2>
      <div className="grid grid-cols-2 gap-4">
        {product.features.slice(0, 4).map((feature) => (
          <div key={feature.id} className="rounded-[6px] border border-[#e7e2d8] bg-white p-5">
            <p className="text-[23px] font-black leading-tight text-[#101827]">{feature.title}</p>
            {feature.description ? (
              <p className="mt-2 line-clamp-3 text-[18px] leading-snug text-[#6b7280]">
                {feature.description}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function SpecificationGroups({ product }: { product: ProductDisplayData }) {
  if (product.specificationGroups.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[28px] font-black text-[#101827]">Product details</h2>
      <div className="grid grid-cols-2 gap-5">
        {product.specificationGroups.slice(0, 2).map((group) => (
          <div key={group.name} className="overflow-hidden rounded-[6px] border border-[#e7e2d8] bg-white">
            <p className="border-b border-[#e7e2d8] bg-[#f7f7f4] px-5 py-3 text-[18px] font-black uppercase tracking-[0.12em] text-[#6b7280]">
              {group.name}
            </p>
            <dl className="divide-y divide-[#ebe7df]">
              {group.items.slice(0, 4).map((item) => (
                <div key={item.id} className="flex justify-between gap-5 px-5 py-3">
                  <dt className="text-[19px] text-[#6b7280]">{item.label}</dt>
                  <dd className="text-right text-[19px] font-bold text-[#111827]">
                    {item.value}
                    {item.unit ? <span className="ml-1 text-[#6b7280]">{item.unit}</span> : null}
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

function MiniGallery({ product, config }: ProductShowcaseViewProps) {
  if (!config.showGallery || product.gallery.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[28px] font-black text-[#101827]">More views</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {product.gallery.map((item) => (
          <div
            key={item.id}
            className="h-[126px] w-[184px] shrink-0 overflow-hidden rounded-[6px] border border-[#e7e2d8] bg-white"
          >
            {item.type === "video" ? (
              <video src={item.url} muted playsInline className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={item.altText ?? product.name}
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
  return (
    <div className="flex h-full w-full bg-[#fbfaf7] font-sans text-[#111827]">
      <ProductMedia product={product} config={config} />

      <main className="flex min-w-0 flex-1 flex-col gap-8 px-12 py-10">
        <ProductSummary product={product} />

        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pr-2">
          <DescriptionBlock product={product} />
          {config.showFeatures ? <FeatureList product={product} /> : null}
          {config.showSpecifications ? <SpecificationGroups product={product} /> : null}
          <MiniGallery product={product} config={config} />
        </div>
      </main>

      <BuyPanel product={product} />
    </div>
  );
}

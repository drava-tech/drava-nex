"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Box } from "lucide-react";
import type { ProductDisplayData, ProductMediaRef } from "@platform/types";
import type { ProductShowcaseContent } from "./content";
import { cn } from "../../lib/utils";

interface ProductShowcaseViewProps {
  product: ProductDisplayData;
  config: ProductShowcaseContent;
}

function getPrimaryMedia(product: ProductDisplayData, config: ProductShowcaseContent) {
  if (config.showVideo && product.video?.url) return product.video;
  return product.hero ?? product.thumbnail ?? product.gallery[0] ?? null;
}

function ProductMediaGallery({
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
    <div className="flex w-[55%] flex-col gap-4">
      {/* Main 1:1 Image Area */}
      <div className="relative aspect-square w-full rounded-md bg-[#f4f2ea] flex items-center justify-center overflow-hidden">
        {/* Zoom / 3D Icon */}
        <button 
          className="absolute right-4 bottom-4 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md transition-transform hover:scale-105 active:scale-95 text-gray-700 hover:text-black"
          title="3D View"
        >
          <Box className="h-5 w-5" />
        </button>

        {primary ? (
          primary.type === "video" ? (
            <video
              src={primary.url}
              autoPlay
              muted
              loop
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={primary.url}
              alt={primary.altText ?? product.name}
              className="h-full w-full object-contain mix-blend-multiply"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-9xl font-black text-black/5">
              {product.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Thumbnails Gallery */}
      {thumbnails.length > 0 && (
        <div className="relative flex items-center gap-2">
          {/* Mock Left Arrow */}
          <button className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-300">
            <ChevronLeft className="h-5 w-5" />
          </button>
          
          <div className="flex flex-1 gap-4 overflow-hidden">
            {thumbnails.slice(0, 4).map((item, idx) => (
              <button
                key={item.id}
                className={cn(
                  "aspect-square w-24 shrink-0 overflow-hidden rounded-md bg-[#f4f2ea] transition-all",
                  idx === 0 ? "border border-gray-400" : "border border-transparent hover:border-gray-300"
                )}
              >
                {item.type === "video" ? (
                  <video src={item.url} muted playsInline className="h-full w-full object-cover mix-blend-multiply" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={item.altText ?? product.name}
                    className="h-full w-full object-cover mix-blend-multiply"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Mock Right Arrow */}
          <button className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-400">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ProductDetails({ product }: { product: ProductDisplayData }) {
  // Mock states for interactive feel
  const [selectedColor, setSelectedColor] = useState("Walnut");
  const [quantity, setQuantity] = useState(1);

  const colors = [
    { name: "Walnut", hex: "#8c5638" },
    { name: "Maple", hex: "#ebd5af" },
    { name: "Black", hex: "#111111" },
  ];

  return (
    <div className="flex w-[45%] flex-col gap-6 pl-8 font-sans text-gray-800">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          {product.name}
        </h1>
        {product.shortDescription && (
          <h2 className="text-xl text-gray-500">{product.shortDescription}</h2>
        )}
      </div>

      {/* Price & Shipping */}
      <div className="flex flex-col gap-2">
        {/* We use a mock price since it's not in the ProductDisplayData schema, or we can use a hardcoded fallback if needed. The reference uses Rs. 850.00 */}
        <p className="text-2xl font-semibold text-gray-800">Rs. 850.00</p>
        <p className="text-sm text-gray-500">
          <a href="#" className="underline decoration-gray-400 underline-offset-4">Shipping</a> calculated at checkout.
        </p>
      </div>

      {/* Color Selector */}
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-500">Color: {selectedColor}</p>
        <div className="flex items-center gap-3">
          {colors.map((c) => (
            <button
              key={c.name}
              onClick={() => setSelectedColor(c.name)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full p-[2px] transition-all",
                selectedColor === c.name ? "border border-gray-400" : "border border-transparent hover:border-gray-300"
              )}
            >
              <span
                className="h-full w-full rounded-full border border-black/10"
                style={{ backgroundColor: c.hex }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Quantity Selector */}
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-500">Quantity</p>
        <div className="flex h-12 w-32 items-center justify-between rounded-full border border-gray-300 px-4 text-gray-600">
          <button 
            className="text-lg hover:text-black"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
          >−</button>
          <span className="text-sm font-medium">{quantity}</span>
          <button 
            className="text-lg hover:text-black"
            onClick={() => setQuantity(quantity + 1)}
          >+</button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3 pt-2">
        <button className="h-14 w-full rounded-full border border-[#4f6153] text-lg font-medium text-[#4f6153] transition-colors hover:bg-[#4f6153]/5">
          Add to cart
        </button>
        <button className="h-14 w-full rounded-full bg-[#4f6153] text-lg font-medium text-white transition-colors hover:bg-[#435246] shadow-sm">
          Buy it now
        </button>
      </div>

      {/* Pickup Info */}
      <div className="flex flex-col gap-1 pt-4 text-sm">
        <div className="flex items-center gap-2 text-gray-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">Pickup available at <span className="font-bold">Shop location</span></span>
        </div>
        <p className="pl-6 text-gray-500">Usually ready in 2-4 days</p>
        <a href="#" className="pl-6 pt-1 text-gray-500 underline decoration-gray-400 underline-offset-4 hover:text-gray-800 transition-colors">
          View store information
        </a>
      </div>

      {/* PIN Code Check */}
      <div className="flex flex-col gap-2 pt-4">
        <p className="text-sm text-gray-600">Enter your PIN code:</p>
        <div className="flex items-center gap-3">
          <input 
            type="text" 
            className="h-10 w-48 rounded-full border border-gray-400 bg-transparent px-4 text-sm outline-none focus:border-[#4f6153] focus:ring-1 focus:ring-[#4f6153]" 
          />
          <button className="h-10 rounded-full bg-[#4f6153] px-6 text-sm font-medium text-white transition-colors hover:bg-[#435246]">
            Check
          </button>
        </div>
      </div>

      {/* Full Description */}
      {product.fullDescription && (
        <div className="pt-6 text-sm leading-relaxed text-gray-500">
          <p className="whitespace-pre-line">{product.fullDescription}</p>
        </div>
      )}
    </div>
  );
}

export function ProductShowcaseView({ product, config }: ProductShowcaseViewProps) {
  return (
    <div className="flex min-h-screen w-full justify-center bg-[#fbfaf5] p-12 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-between">
        <ProductMediaGallery product={product} config={config} />
        <ProductDetails product={product} />
      </div>
    </div>
  );
}

export function ProductShowcaseLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#fbfaf5]">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-[#4f6153]" />
    </div>
  );
}

export function ProductShowcaseUnavailable({ name }: { name?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#fbfaf5] text-2xl font-medium text-gray-500">
      {name ? `${name} is currently unavailable.` : "Product is currently unavailable."}
    </div>
  );
}

export function ProductShowcaseError({ message }: { message?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#fbfaf5] text-2xl font-medium text-red-600">
      {message ?? "An error occurred while loading this product."}
    </div>
  );
}

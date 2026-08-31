import { Package } from "lucide-react";
import type { MatInventoryDisplayItem } from "@platform/types";

interface ObjectRecognitionViewProps {
  items: MatInventoryDisplayItem[];
}

function ObjectRecognitionCard({ item }: { item: MatInventoryDisplayItem }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-md bg-[#f4f2ea] p-8">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white">
        <Package className="h-10 w-10 text-gray-400" />
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-2xl font-semibold text-gray-900">{item.name}</p>
        {item.count > 1 && <p className="text-lg text-gray-500">x{item.count}</p>}
      </div>
    </div>
  );
}

export function ObjectRecognitionView({ items }: ObjectRecognitionViewProps) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center gap-10 bg-[#fbfaf5] p-16">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">On the mat</h1>
      <div className="grid w-full max-w-5xl grid-cols-3 gap-8">
        {items.map((item) => (
          <ObjectRecognitionCard key={item.productId} item={item} />
        ))}
      </div>
    </div>
  );
}

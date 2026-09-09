"use client";

import { useState } from "react";
import Image from "next/image";

interface PriceAlertButtonProps {
  productId: number;
  productName: string;
  productImageUrl?: string;
  productUrl?: string;
  currentLowestPrice?: string;
  currency?: string;
  className?: string;
}

export function PriceAlertButton({
  productId,
  productName,
  productImageUrl,
  productUrl,
  currentLowestPrice,
  currency = "USD",
  className = "",
}: PriceAlertButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors ${className}`}
        aria-label={`Set price alert for ${productName}`}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        Set Price Alert
      </button>

      {isModalOpen && (
        <PriceAlertModal
          productId={productId}
          productName={productName}
          productImageUrl={productImageUrl}
          productUrl={productUrl}
          currentLowestPrice={currentLowestPrice}
          currency={currency}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}

interface PriceAlertModalProps {
  productId: number;
  productName: string;
  productImageUrl?: string;
  productUrl?: string;
  currentLowestPrice?: string;
  currency?: string;
  onClose: () => void;
}

function PriceAlertModal({
  productId,
  productName,
  productImageUrl,
  productUrl,
  currentLowestPrice,
  currency = "USD",
  onClose,
}: PriceAlertModalProps) {
  const [email, setEmail] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !targetPrice) {
      setError("Please fill in all fields");
      return;
    }

    const targetPriceNum = parseFloat(targetPrice);
    if (isNaN(targetPriceNum) || targetPriceNum <= 0) {
      setError("Please enter a valid target price");
      return;
    }

    const priceAtAdd = (() => {
      if (!currentLowestPrice) {
        return targetPriceNum;
      }

      const parsed = parseFloat(currentLowestPrice);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : targetPriceNum;
    })();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);

    try {
       const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
       const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
       const response = await fetch(`${baseUrl}/v1/user/alerts`, {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
         },
         body: JSON.stringify({
           email,
           product_id: productId,
           product_name: productName,
           product_image_url: productImageUrl,
           product_url: productUrl,
           target_price: targetPriceNum,
           currency: "USD",
         }),
       });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to create alert");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch {
       // Fallback to localStorage when API fails
       try {
         const alerts = JSON.parse(localStorage.getItem('buywhere_price_alerts') || '[]');
         const newAlert = {
           id: Date.now().toString(),
           email,
           product_id: productId,
           product_name: productName,
           product_image_url: productImageUrl,
           product_url: productUrl,
           price_at_add: priceAtAdd,
           target_price: targetPriceNum,
           currency: "USD",
           created_at: new Date().toISOString(),
           status: "active"
         };
         localStorage.setItem('buywhere_price_alerts', JSON.stringify([...alerts, newAlert]));
         setSuccess(true);
         setTimeout(() => {
           onClose();
         }, 2000);
       } catch {
         setError("Failed to create alert. Please check your connection and try again.");
       }
     } finally {
       setIsSubmitting(false);
     }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-alert-title"
      >
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 id="price-alert-title" className="text-xl font-bold text-gray-900">
              Set Price Alert
            </h2>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {success ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Alert Created!</h3>
            <p className="text-gray-600">
              We&apos;ll email you when the price drops below ${targetPrice}.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6">
            <div className="flex gap-4 mb-6">
              {productImageUrl && (
                <Image
                  src={productImageUrl}
                  alt={productName}
                  width={64}
                  height={64}
                  className="object-cover rounded-lg bg-gray-100 flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 line-clamp-2 text-sm">
                  {productName}
                </h3>
                {currentLowestPrice && (
                  <p className="text-sm text-gray-500 mt-1">
                    Current lowest: <span className="font-semibold text-gray-900">{currency}{currentLowestPrice}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="alert-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email address
                </label>
                <input
                  id="alert-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label htmlFor="alert-target-price" className="block text-sm font-medium text-gray-700 mb-1">
                  Target price (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="alert-target-price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  We&apos;ll notify you when the price drops to or below this amount.
                </p>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Creating..." : "Create Alert"}
              </button>
            </div>
          </form>
        )}

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500 text-center">
            By creating an alert, you agree to receive email notifications when prices drop.
            You can delete your alert at any time.
          </p>
        </div>
      </div>
    </div>
  );
}

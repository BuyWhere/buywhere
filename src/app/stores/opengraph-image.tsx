import { ImageResponse } from 'next/og';

export const alt = 'Browse Stores — BuyWhere';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: 'linear-gradient(135deg, #312e81 0%, #3730a3 50%, #4338ca 100%)',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Inter, Arial, sans-serif',
          height: '100%',
          justifyContent: 'center',
          padding: '72px',
          width: '100%',
        }}
      >
        <div
          style={{
            color: '#a5b4fc',
            display: 'flex',
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 48,
          }}
        >
          BuyWhere
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 86,
            fontWeight: 800,
            letterSpacing: '-0.05em',
            lineHeight: 1,
            marginBottom: 32,
            textAlign: 'center',
          }}
        >
          Browse Stores
        </div>
        <div
          style={{
            color: '#c7d2fe',
            display: 'flex',
            fontSize: 34,
            lineHeight: 1.3,
            maxWidth: 860,
            textAlign: 'center',
          }}
        >
          Compare prices across Shopee, Lazada, Amazon, Walmart, and more.
        </div>
        <div
          style={{
            background: '#818cf8',
            borderRadius: 999,
            color: '#1e1b4b',
            display: 'flex',
            fontSize: 28,
            fontWeight: 700,
            marginTop: 56,
            padding: '18px 32px',
          }}
        >
          Shop smarter. All stores in one search.
        </div>
      </div>
    ),
    size
  );
}

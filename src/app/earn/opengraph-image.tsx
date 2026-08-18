import { ImageResponse } from 'next/og';

export const alt = 'Earn Cashback — BuyWhere';
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
          background: 'linear-gradient(135deg, #dbeafe 0%, #ffffff 50%, #eff6ff 100%)',
          color: '#1e3a8a',
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
            color: '#2563eb',
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
          Earn Cashback
        </div>
        <div
          style={{
            color: '#475569',
            display: 'flex',
            fontSize: 34,
            lineHeight: 1.3,
            maxWidth: 860,
            textAlign: 'center',
          }}
        >
          Shop through BuyWhere and get rewards back on your everyday spending.
        </div>
        <div
          style={{
            background: '#1e40af',
            borderRadius: 999,
            color: '#ffffff',
            display: 'flex',
            fontSize: 28,
            fontWeight: 700,
            marginTop: 56,
            padding: '18px 32px',
          }}
        >
          Compare prices. Shop smarter. Earn rewards.
        </div>
      </div>
    ),
    size
  );
}

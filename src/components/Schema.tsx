// Schema component renders a JSON-LD structured-data block.
// Pass either a pre-built object (`data`) or use the page-schema helpers.

type SchemaProps = {
  data: object;
};

export default function Schema({ data }: SchemaProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

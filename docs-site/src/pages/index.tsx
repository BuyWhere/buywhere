import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: '5M+ Products',
    Svg: require('@site/static/img/feature-catalog.svg').default,
    description: (
      <>
        Search 40+ retailers across Singapore, Malaysia, Thailand, Indonesia,
        Vietnam, Philippines, and the US — all from one API.
      </>
    ),
  },
  {
    title: 'AI Agent Ready',
    Svg: require('@site/static/img/feature-agent.svg').default,
    description: (
      <>
        Structured JSON, compact payloads optimized for LLMs, and an MCP server
        for direct integration with Claude Desktop and Cursor.
      </>
    ),
  },
  {
    title: 'Get Started in 3 Seconds',
    Svg: require('@site/static/img/feature-key.svg').default,
    description: (
      <>
        No signup, no email, no human in the loop. Register and get a live API
        key instantly — start building immediately.
      </>
    ),
  },
];

function Feature({ title, Svg, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Terminal() {
  return (
    <div className={styles.terminal}>
      <div className={styles.terminalHeader}>
        <span className={styles.dot} style={{ background: '#ff5f57' }} />
        <span className={styles.dot} style={{ background: '#febc2e' }} />
        <span className={styles.dot} style={{ background: '#28c840' }} />
        <span className={styles.termTitle}>bash</span>
      </div>
      <pre className={styles.termBody}><code>{`$ curl -X POST https://api.buywhere.ai/v1/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"agent_name": "my-shopping-agent"}'

→ HTTP/2 200
{
  "api_key": "bw_live_4xKq9mNpR2...",
  "tier": "unverified",
  "rate_limit": { "rpm": 20, "daily": 1000 }
}

$ curl "https://api.buywhere.ai/v1/products/search?q=sony+wh1000xm5" \\
  -H "Authorization: Bearer $BUYWHERE_API_KEY"

→ HTTP/2 200
{
  "results": [
    {
      "title": "Sony WH-1000XM5 Wireless Headphones",
      "price": { "amount": 349.00, "currency": "SGD" },
      "merchant": "amazon.sg",
      "url": "https://www.amazon.sg/dp/..."
    }
  ],
  "total": 842,
  "response_time_ms": 87
}`}</code></pre>
    </div>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="API Reference"
      description="The product catalog API for AI agents. Search 5M+ products from 40+ retailers across Southeast Asia and the US.">
      <main>

        {/* ── Hero ─────────────────────────────────────────── */}
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroGrid}>
              <div className={styles.heroText}>
                <h1 className={styles.heroTitle}>
                  The product catalog API<br />for AI agents
                </h1>
                <p className={styles.heroSub}>
                  Search 5M+ products from 40+ retailers across Southeast Asia
                  and the US. Compare prices, track deals, and integrate product
                  data into any AI application.
                </p>
                <div className={styles.heroCta}>
                  <Link
                    className="button button--primary button--lg"
                    to="/docs/getting-started">
                    Get API Key →
                  </Link>
                  <Link
                    className="button button--outline button--lg"
                    to="/docs/api-reference/search">
                    API Reference
                  </Link>
                </div>
                <div className={styles.heroStats}>
                  <span>5M+ products</span>
                  <span className={styles.statDot}>·</span>
                  <span>40+ retailers</span>
                  <span className={styles.statDot}>·</span>
                  <span>7 countries</span>
                </div>
              </div>
              <div className={styles.heroTerminal}>
                <Terminal />
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────── */}
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {FeatureList.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Quickstart ───────────────────────────────────── */}
        <section className={styles.quickstart}>
          <div className="container">
            <div className={styles.qsGrid}>
              <div className={styles.qsText}>
                <Heading as="h2">Get started in 60 seconds</Heading>
                <p>
                  Register for an API key, make your first search, and integrate
                  into your AI agent — all without leaving your terminal.
                </p>
                <ol className={styles.qsSteps}>
                  <li><strong>1. Get your key</strong> — copy the curl example above.</li>
                  <li><strong>2. Search live</strong> — any product, any country.</li>
                  <li><strong>3. Integrate</strong> — Python, Node.js, or MCP.</li>
                </ol>
                <div className={styles.qsLinks}>
                  <Link className="button button--primary" to="/docs/getting-started">
                    Read the Docs →
                  </Link>
                  <Link className="button button--outline" to="/docs/guides/mcp-integration">
                    MCP Integration →
                  </Link>
                </div>
              </div>
              <div className={styles.qsCode}>
                <div className={styles.codeCard}>
                  <div className={styles.codeHeader}>
                    <span>Python · httpx</span>
                  </div>
                  <pre><code>{`import httpx

API_KEY = "bw_live_your_key_here"

resp = httpx.get(
    "https://api.buywhere.ai/v1/products/search",
    params={
        "q": "sony headphones",
        "country_code": "SG",
        "limit": 5,
    },
    headers={"Authorization": f"Bearer {API_KEY}"},
)

for p in resp.json()["results"]:
    print(f"{p["title"]} — {p["price"]["amount"]}")`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── MCP Banner ───────────────────────────────────── */}
        <section className={styles.mcpBanner}>
          <div className="container">
            <div className={styles.mcpRow}>
              <div>
                <Heading as="h2">Works with your AI tools</Heading>
                <p>
                  BuyWhere ships an MCP server. Connect directly to Claude Desktop,
                  Cursor, Windsurf, and any MCP-compatible AI agent.
                </p>
              </div>
              <Link
                className="button button--secondary button--lg"
                to="/docs/guides/mcp-integration">
                MCP Setup Guide →
              </Link>
            </div>
          </div>
        </section>

      </main>
    </Layout>
  );
}

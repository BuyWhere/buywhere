import styles from './Disclosure.module.css';

interface DisclosureProps {
  updatedAt: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  }
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  }
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

export default function Disclosure({ updatedAt }: DisclosureProps) {
  return (
    <footer className={styles.disclosure}>
      <p className={styles.text}>
        Prices updated {formatRelativeTime(updatedAt)}. BuyWhere earns commission on purchases through retailer links.
      </p>
    </footer>
  );
}
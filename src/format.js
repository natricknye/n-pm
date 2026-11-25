export const statusLabel = {
  active: '推进中',
  planning: '初始',
  paused: '暂缓中',
  done: '归档',
};

export const priorityLabel = {
  high: '高',
  medium: '中',
  low: '低',
};

export const relationLabel = {
  ownership: 'Ownership',
  contribute: 'Contribute',
};

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function timeAgo(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

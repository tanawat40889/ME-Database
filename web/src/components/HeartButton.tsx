import { HeartIcon } from './icons';

export function HeartButton({
  on,
  onToggle,
  className = '',
}: {
  on: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`grid size-11 place-items-center rounded-full transition active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 ${on ? 'text-rose-500' : 'text-white/90'} ${className}`}
    >
      <HeartIcon filled={on} className="size-6 drop-shadow" />
    </button>
  );
}

export default function Header({ connected, idle }) {
  let dotClass = 'dot';
  if (connected) dotClass += idle ? ' idle' : ' connected';

  return (
    <div className="header">
      <span className={dotClass}></span>
      <span className="brand">Microscape Minion</span>
    </div>
  );
}

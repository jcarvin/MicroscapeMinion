export default function SkillNotifyToggleSection({ targetLevel, checked, onChange }) {
  return (
    <div className="skill-notify-row">
      <label className="skill-notify-label">
        <span className="toggle-switch">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
          />
          <span className="toggle-track"></span>
        </span>
        Notify when Lv {targetLevel} is reached
      </label>
    </div>
  );
}

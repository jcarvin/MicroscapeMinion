import EtaLogPanel from './EtaLogPanel';
import NagPanel from './NagPanel';
import RawStatePanel from './RawStatePanel';
import TickLogPanel from './TickLogPanel';

export default function DebugSection({
  rawMe,
  tickLog,
  etaDebugLog,
  etaDebugLogVersion,
  goalNagDebug,
  onCheckGoalNags,
}) {
  return (
    <>
      <RawStatePanel rawMe={rawMe} />
      <TickLogPanel tickLog={tickLog} />
      <EtaLogPanel etaDebugLog={etaDebugLog} etaDebugLogVersion={etaDebugLogVersion} />
      <NagPanel goalNagDebug={goalNagDebug} onCheckGoalNags={onCheckGoalNags} />
    </>
  );
}

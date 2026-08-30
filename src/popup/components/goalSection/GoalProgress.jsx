import { formatDuration, formatNumber } from '../../utils/format';
import { EtaGroup, EtaLabel } from '../Shared';
import EtaDisplay from '../EtaDisplay';
import EtaTooltip from '../EtaTooltip';
import {
  GoalStatus,
  ProgressBar,
  ProgressBarWrap,
  ProgressCounts,
  ProgressDivider,
  ProgressLabel,
} from './GoalSection.styles';

export default function GoalProgress({
  count,
  targetCount,
  pct,
  complete,
  relatedToActivity,
  etaMs,
  bankTrips,
  warmupRemainingMs,
  preliminaryEta,
}) {
  return (
    <GoalStatus>
      <ProgressBarWrap>
        <ProgressBar className="progress-bar" style={{ width: `${pct}%` }} />
      </ProgressBarWrap>
      <ProgressLabel>
        <ProgressCounts>
          <span>{formatNumber(count)} / {formatNumber(targetCount)}</span>
          {!complete && count < targetCount && (
            <span>{formatNumber(targetCount - count)} remaining</span>
          )}
        </ProgressCounts>
        {relatedToActivity && (
          <>
            <ProgressDivider aria-hidden="true" />
            <EtaGroup>
              <EtaDisplay
                etaMs={etaMs}
                bankTrips={bankTrips}
                complete={complete}
                warmupRemainingMs={warmupRemainingMs}
              />
              <EtaTooltip />
            </EtaGroup>
          </>
        )}
        {!relatedToActivity && !complete && preliminaryEta != null
          && preliminaryEta !== 0
          && preliminaryEta?.totalMs > 0 && (
          <>
            <ProgressDivider aria-hidden="true" />
            <EtaGroup>
              <EtaLabel>
                {`~${formatDuration(preliminaryEta.totalMs)}`}
                {preliminaryEta.bankTrips > 0
                  ? ` (+${preliminaryEta.bankTrips} bank trip${preliminaryEta.bankTrips > 1 ? 's' : ''})`
                  : ''}
              </EtaLabel>
            </EtaGroup>
          </>
        )}
      </ProgressLabel>
    </GoalStatus>
  );
}

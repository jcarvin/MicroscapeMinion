import { createPortal } from 'react-dom';
import styled from 'styled-components';
import useModalDismiss from '../../hooks/useModalDismiss';
import { formatItemId, formatNumber, formatSkillName } from '../../utils/format';
import { MIN_RECEPTACLE_COUNT, MAX_RECEPTACLE_COUNT } from '../../../build-plan.js';
import { displayItemName } from './goalUtils';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Dialog = styled.div`
  background: ${({ theme }) => theme.parchmentLight};
  border: 3px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: 3px 3px 0 rgba(0,0,0,0.4);
  padding: 14px 16px;
  width: 310px;
  max-height: 520px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
`;

const DialogTitle = styled.h2`
  font-size: 13px;
  font-weight: bold;
  color: ${({ theme }) => theme.brown900};
  margin: 0;
`;

const TreeScroll = styled.div`
  overflow-y: auto;
  flex: 1;
  min-height: 0;
`;

const TreeList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TreeItem = styled.li`
  padding-left: ${({ $depth }) => $depth * 14}px;
`;

const NodeRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: ${({ $status, theme }) =>
    $status === 'purchase-only' ? theme.amber :
    $status === 'drops' ? theme.muted :
    $status === 'sufficient' ? theme.brown500 :
    theme.brown900};
`;

const NodeLabel = styled.span`
  flex: 1;
  min-width: 0;
`;

const NodeBadge = styled.span`
  font-size: 10px;
  flex-shrink: 0;
  opacity: 0.75;
`;

const WarningBadge = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.amber};
  flex-shrink: 0;
`;

const IncompleteWarning = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.amber};
  border: 1px solid ${({ theme }) => theme.amber};
  border-radius: ${({ theme }) => theme.radius};
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid ${({ theme }) => theme.border};
  flex-shrink: 0;
`;

const Legend = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.brown500};
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const LegendItem = styled.span`
  color: ${({ $color, theme }) => $color === 'amber' ? theme.amber : $color === 'muted' ? theme.muted : theme.brown500};
`;

const ConfirmBtn = styled.button`
  padding: 4px 12px;
  font-size: 12px;
  background: ${({ theme }) => theme.accent};
  border: 2px solid #1d4316;
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.text};
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.1);
  &:hover { background: #3d6e1c; }
  &:active { transform: translateY(1px); box-shadow: none; }
  &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
`;

const CancelBtn = styled.button`
  padding: 4px 10px;
  font-size: 12px;
  background: ${({ theme }) => theme.parchment};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.brown900};
  &:hover { background: ${({ theme }) => theme.parchmentDark}; }
  &:active { transform: translateY(1px); box-shadow: none; }
`;

function getItemDisplayName(itemId, goalItems) {
  const item = goalItems?.find((gi) => gi.id === itemId);
  return displayItemName(item) || formatItemId(itemId);
}

function statusBadge(node) {
  switch (node.status) {
    case 'craftable':  return `[craft${node.skill ? `: ${formatSkillName(node.skill)}` : ''}]`;
    case 'gatherable': return `[gather${node.skill ? `: ${formatSkillName(node.skill)}` : ''}]`;
    case 'drops':      return '[combat drop]';
    case 'sufficient': return '[have enough]';
    case 'circular':   return '[circular!]';
    default:           return '[buy]';
  }
}

function PlanTreeNode({ node, depth, goalItems }) {
  const name = getItemDisplayName(node.itemId, goalItems);
  const qty = node.quantity > 0 ? formatNumber(node.quantity) : null;
  const haveNote = node.owned > 0 && node.needed > 0
    ? `have ${formatNumber(node.owned)}, need ${formatNumber(node.needed)} more`
    : null;

  return (
    <>
      <TreeItem $depth={depth}>
        <NodeRow $status={node.status}>
          <NodeLabel>
            {qty ? <strong>{qty}×</strong> : null}{' '}
            {name}
            {haveNote && <> <span style={{ opacity: 0.7 }}>({haveNote})</span></>}
          </NodeLabel>
          <NodeBadge>{statusBadge(node)}</NodeBadge>
          {node.levelBlocked && node.status !== 'purchase-only' && (
            <WarningBadge>
              {node.skill
                ? `⚠ ${formatSkillName(node.skill)} Lv ${node.requiredLevel}`
                : '⚠ level req'}
            </WarningBadge>
          )}
          {node.status === 'purchase-only' && node.levelBlocked && node.minCombatLevel != null && (
            <WarningBadge>⚠ Combat Lv {node.minCombatLevel}+</WarningBadge>
          )}
        </NodeRow>
      </TreeItem>
      {node.children.map((child) => (
        <PlanTreeNode key={child.itemId} node={child} depth={depth + 1} goalItems={goalItems} />
      ))}
    </>
  );
}

function hasActionableNodes(node) {
  if (['craftable', 'gatherable', 'drops'].includes(node.status)) return true;
  return node.children.some(hasActionableNodes);
}

function hasPurchaseOnly(node) {
  if (node.status === 'purchase-only') return true;
  return node.children.some(hasPurchaseOnly);
}

function hasDropNodes(node) {
  if (node.status === 'drops') return true;
  return node.children.some(hasDropNodes);
}

function collectPurchaseOnlyLeaves(node, goalItems) {
  if (node.status === 'purchase-only' && node.needed > 0) {
    return [`${formatNumber(node.needed)}× ${getItemDisplayName(node.itemId, goalItems)}`];
  }
  return node.children.flatMap((child) => collectPurchaseOnlyLeaves(child, goalItems));
}

function collectLevelBlockedLeaves(node, goalItems) {
  if (node.levelBlocked && node.status !== 'purchase-only' && node.needed > 0) {
    const name = getItemDisplayName(node.itemId, goalItems);
    const levelNote = node.skill
      ? `${formatSkillName(node.skill)} Lv ${node.requiredLevel}`
      : node.requiredLevel
        ? `Lv ${node.requiredLevel}`
        : 'level req';
    return [`${formatNumber(node.needed)}× ${name} (${levelNote})`];
  }
  return node.children.flatMap((child) => collectLevelBlockedLeaves(child, goalItems));
}

export default function BuildPlanDialog({ itemName, tree, goalItems, receptacleWarnings, onSetQueue, onClose }) {
  useModalDismiss(onClose);

  const canQueue = tree && hasActionableNodes(tree);
  const showPurchaseLegend = tree && hasPurchaseOnly(tree);
  const showDropLegend = tree && hasDropNodes(tree);
  const purchaseOnlyLeaves = tree ? collectPurchaseOnlyLeaves(tree, goalItems) : [];
  const levelBlockedLeaves = tree ? collectLevelBlockedLeaves(tree, goalItems) : [];

  const blockingReceptacles = (receptacleWarnings ?? []).filter((w) => w.level === 'blocking');
  const efficiencyReceptacles = (receptacleWarnings ?? []).filter((w) => w.level === 'efficiency');

  return createPortal(
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Dialog role="dialog" aria-modal="true" aria-label="Build Plan">
        <DialogTitle>Build Plan: {itemName}</DialogTitle>

        <TreeScroll>
          {tree && (
            <TreeList>
              <PlanTreeNode node={tree} depth={0} goalItems={goalItems} />
            </TreeList>
          )}
        </TreeScroll>

        {(showPurchaseLegend || showDropLegend) && (
          <Legend>
            {showPurchaseLegend && <LegendItem $color="amber">[buy] = purchase from bazaar</LegendItem>}
            {showDropLegend && <LegendItem $color="muted">[combat drop] = queued as combat</LegendItem>}
          </Legend>
        )}

        {(purchaseOnlyLeaves.length > 0 || levelBlockedLeaves.length > 0 ||
          blockingReceptacles.length > 0 || efficiencyReceptacles.length > 0) && (
          <IncompleteWarning>
            {purchaseOnlyLeaves.length > 0 && (
              <div>⚠ Plan is incomplete — buy these first: <strong>{purchaseOnlyLeaves.join(', ')}</strong></div>
            )}
            {levelBlockedLeaves.length > 0 && (
              <div>⚠ Level-blocked: <strong>{levelBlockedLeaves.join(', ')}</strong></div>
            )}
            {blockingReceptacles.map((w) => (
              <div key={w.emptyId}>
                ⚠ Buy more <strong>{formatItemId(w.emptyId)}</strong> to build this plan
                {' '}(have {w.total}, need {MIN_RECEPTACLE_COUNT}+)
              </div>
            ))}
            {efficiencyReceptacles.map((w) => (
              <div key={w.emptyId}>
                Buy more <strong>{formatItemId(w.emptyId)}</strong> for a more efficient build plan
                {' '}(have {w.total}, max {MAX_RECEPTACLE_COUNT})
              </div>
            ))}
          </IncompleteWarning>
        )}

        <Footer>
          <CancelBtn type="button" onClick={onClose}>Cancel</CancelBtn>
          <ConfirmBtn type="button" disabled={!canQueue} onClick={onSetQueue}>
            Set Queue
          </ConfirmBtn>
        </Footer>
      </Dialog>
    </Overlay>,
    document.body
  );
}

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import usePortalPosition from '../../hooks/usePortalPosition';
import useClickOutside from '../../hooks/useClickOutside';

const Wrap = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

const ZoneLabel = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.brown700};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
`;

const ChangeBtn = styled.button`
  font-size: 10px;
  color: ${({ theme }) => theme.muted};
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0 2px;
  cursor: pointer;
  &:hover { color: ${({ theme }) => theme.text}; }
  &:active { transform: none; box-shadow: none; }
`;

const ChooseBtn = styled.button`
  font-size: 11px;
  color: ${({ theme }) => theme.amber};
  background: transparent;
  border: 1px dashed ${({ theme }) => theme.amber};
  border-radius: ${({ theme }) => theme.radius};
  padding: 1px 6px;
  cursor: pointer;
  box-shadow: none;
  &:hover { background: rgba(200,148,57,0.12); }
  &:active { transform: none; box-shadow: none; }
`;

const DropList = styled.ul`
  position: fixed;
  min-width: 160px;
  background: ${({ theme }) => theme.parchmentLight};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  list-style: none;
  margin: 0;
  padding: 3px 0;
  z-index: 10000;
  max-height: 140px;
  overflow-y: auto;
  box-shadow: 3px 3px 0 rgba(0,0,0,0.3);
`;

const DropItem = styled.li`
  padding: 5px 9px;
  cursor: pointer;
  font-size: 12px;
  color: ${({ theme }) => theme.brown900};
  background: ${({ $selected }) => $selected ? 'rgba(78,133,41,.15)' : 'transparent'};
  &:hover { background: ${({ theme }) => theme.accent}; color: ${({ theme }) => theme.text}; }
`;

const ErrorText = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.red};
`;

const PendingText = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.muted};
  font-style: italic;
`;

export default function QueueStepLocationPicker({
  zoneId,
  zoneCandidates,
  resolutionSource,
  error,
  onSelect,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef(null);
  const dropStyle = usePortalPosition(anchorRef, isOpen);
  useClickOutside(anchorRef, () => setIsOpen(false));

  if (error) {
    return <ErrorText title={error}>No location data</ErrorText>;
  }

  const selectedName = zoneCandidates?.find(c => c.zoneId === zoneId)?.zoneName ?? zoneId;
  const isResolved = zoneId != null;

  const hasCandidates = zoneCandidates && zoneCandidates.length > 0;

  return (
    <Wrap ref={anchorRef}>
      {isResolved ? (
        <>
          <ZoneLabel title={selectedName}>{selectedName}</ZoneLabel>
          {zoneCandidates?.length > 1 && (
            <ChangeBtn
              type="button"
              onClick={() => setIsOpen(v => !v)}
            >
              change
            </ChangeBtn>
          )}
        </>
      ) : hasCandidates ? (
        <ChooseBtn type="button" onClick={() => setIsOpen(v => !v)}>
          Choose a location
        </ChooseBtn>
      ) : (
        <PendingText title="Zone data not yet loaded — reopen this dialog once the game bundle loads">
          No zone data
        </PendingText>
      )}
      {isOpen && createPortal(
        <DropList style={dropStyle}>
          {(zoneCandidates ?? []).map(({ zoneId: candidateId, zoneName }) => (
            <DropItem
              key={candidateId}
              $selected={candidateId === zoneId}
              onMouseDown={() => {
                onSelect(candidateId);
                setIsOpen(false);
              }}
            >
              {zoneName}
            </DropItem>
          ))}
        </DropList>,
        document.body
      )}
    </Wrap>
  );
}

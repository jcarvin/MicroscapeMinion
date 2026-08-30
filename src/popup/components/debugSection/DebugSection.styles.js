import styled from 'styled-components';

export const DebugDetails = styled.details`
  padding: 0 12px;

  summary {
    font-size: 10px;
    color: ${({ theme }) => theme.muted};
    cursor: pointer;
    padding: 8px 0 4px;
    list-style: none;
    user-select: none;

    &::before { content: '▶ '; }
  }

  &[open] summary::before { content: '▼ '; }
`;

export const DebugMePre = styled.pre`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  font: 10px/1.5 'Cascadia Code', 'Fira Code', monospace;
  margin-bottom: 4px;
  max-height: 180px;
  overflow: auto;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-all;
`;

export const DebugPre = styled.pre`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  font: 9.5px/1.5 'Cascadia Code', 'Fira Code', monospace;
  margin-bottom: 4px;
  max-height: 220px;
  overflow: auto;
  padding: 6px 8px;
  white-space: pre;
`;

export const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
`;

export const PanelHint = styled.span`
  font-size: 9px;
  color: ${({ theme }) => theme.muted};
  flex: 1;
  line-height: 1.3;
`;

export const CopyLogBtn = styled.button`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  font: 600 10px/1 inherit;
  padding: 3px 7px;
  flex-shrink: 0;

  &:hover {
    color: ${({ theme }) => theme.text};
    border-color: ${({ theme }) => theme.accent};
  }
`;

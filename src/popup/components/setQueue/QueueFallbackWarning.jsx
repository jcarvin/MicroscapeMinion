import styled from 'styled-components';

const Warning = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.red};
  padding: 4px 0;
`;

export default function QueueFallbackWarning({ hasFallback }) {
  if (hasFallback) return null;
  return (
    <Warning>
      No fallback activity is set. The queue will stop if no step can complete.
    </Warning>
  );
}

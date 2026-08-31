import { createGlobalStyle } from 'styled-components';

const GlobalStyles = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    width: 350px;
    max-height: 600px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: ${({ theme }) => theme.bg};
    color: ${({ theme }) => theme.text};
    font: 13px/1.4 'IBM Plex Mono', monospace;
    border: 4px solid #71451f;
    box-shadow: inset 0 0 0 2px #a56a30, inset 0 0 0 6px #122812;
  }

  #root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  input[type="text"],
  input[type="number"] {
    background: ${({ theme }) => theme.parchmentLight};
    border: 2px solid ${({ theme }) => theme.brown700};
    border-radius: ${({ theme }) => theme.radius};
    color: ${({ theme }) => theme.brown900};
    font: inherit;
    padding: 4px 7px;
    outline: none;
    min-width: 0;
  }
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; }
  input[type="number"] { -moz-appearance: textfield; }
  input:focus { border-color: ${({ theme }) => theme.accent}; }

  button {
    background: ${({ theme }) => theme.parchment};
    border: 2px solid ${({ theme }) => theme.brown700};
    border-radius: ${({ theme }) => theme.radius};
    color: ${({ theme }) => theme.brown900};
    cursor: pointer;
    font: 600 12px/1 inherit;
    padding: 5px 10px;
    white-space: nowrap;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.18), 0 3px 0 ${({ theme }) => theme.brown700};
  }
  button:hover { background: ${({ theme }) => theme.parchmentLight}; filter: none; }
  button:active {
    transform: translateY(1px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 0 ${({ theme }) => theme.brown700};
  }
`;

export default GlobalStyles;

import { createGlobalStyle } from 'styled-components';

const GlobalStyles = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    width: 280px;
    max-height: 600px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: ${({ theme }) => theme.bg};
    color: ${({ theme }) => theme.text};
    font: 13px/1.4 'Segoe UI', system-ui, sans-serif;
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
    background: ${({ theme }) => theme.bg};
    border: 1px solid ${({ theme }) => theme.border};
    border-radius: ${({ theme }) => theme.radius};
    color: ${({ theme }) => theme.text};
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
    background: ${({ theme }) => theme.accent};
    border: none;
    border-radius: ${({ theme }) => theme.radius};
    color: #fff;
    cursor: pointer;
    font: 600 12px/1 inherit;
    padding: 5px 10px;
    white-space: nowrap;
  }
  button:hover { filter: brightness(1.1); }
`;

export default GlobalStyles;

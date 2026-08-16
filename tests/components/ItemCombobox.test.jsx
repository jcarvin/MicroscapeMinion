import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ItemCombobox from '../../src/popup/components/ItemCombobox';

const items = [
  { id: 'woodLog', count: 10 },
  { id: 'stone',   count: 5 },
];

describe('ItemCombobox', () => {
  it('is closed on initial render', () => {
    render(<ItemCombobox items={items} selectedId={null} onSelect={vi.fn()} />);
    expect(document.querySelector('.combo-options')).not.toBeInTheDocument();
  });

  it('opens on focus when items are available', async () => {
    const user = userEvent.setup();
    render(<ItemCombobox items={items} selectedId={null} onSelect={vi.fn()} />);
    await user.click(screen.getByPlaceholderText('Select item'));
    expect(document.querySelector('.combo-options')).toBeInTheDocument();
    expect(screen.getByText('Wood Log')).toBeInTheDocument();
    expect(screen.getByText('Stone')).toBeInTheDocument();
  });

  it('filters items when typing', async () => {
    const user = userEvent.setup();
    render(<ItemCombobox items={items} selectedId={null} onSelect={vi.fn()} />);
    await user.click(screen.getByPlaceholderText('Select item'));
    await user.type(screen.getByPlaceholderText('Select item'), 'wood');
    expect(screen.getByText('Wood Log')).toBeInTheDocument();
    expect(screen.queryByText('Stone')).not.toBeInTheDocument();
  });

  it('calls onSelect and closes when an option is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ItemCombobox items={items} selectedId={null} onSelect={onSelect} />);
    await user.click(screen.getByPlaceholderText('Select item'));
    await user.click(screen.getByText('Wood Log'));
    expect(onSelect).toHaveBeenCalledWith('woodLog');
    expect(document.querySelector('.combo-options')).not.toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(<ItemCombobox items={items} selectedId={null} onSelect={vi.fn()} />);
    await user.click(screen.getByPlaceholderText('Select item'));
    expect(document.querySelector('.combo-options')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(document.querySelector('.combo-options')).not.toBeInTheDocument();
  });

  it('closes on click outside', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ItemCombobox items={items} selectedId={null} onSelect={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    await user.click(screen.getByPlaceholderText('Select item'));
    expect(document.querySelector('.combo-options')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(document.querySelector('.combo-options')).not.toBeInTheDocument();
  });

  it('shows no-match message when filter has no results', async () => {
    const user = userEvent.setup();
    render(<ItemCombobox items={items} selectedId={null} onSelect={vi.fn()} />);
    await user.click(screen.getByPlaceholderText('Select item'));
    await user.type(screen.getByPlaceholderText('Select item'), 'zzz');
    expect(screen.getByText('No match')).toBeInTheDocument();
  });
});

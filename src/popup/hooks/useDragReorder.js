import { useState } from 'react';

export default function useDragReorder(onReorder) {
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  function startDrag(id) {
    setDraggedId(id);
    setDragOverId(null);
  }

  function endDrag() {
    setDraggedId(null);
    setDragOverId(null);
  }

  function enterDrag(id) {
    if (draggedId) setDragOverId(draggedId === id ? null : id);
  }

  function drop(overId) {
    if (draggedId && draggedId !== overId) onReorder(draggedId, overId);
    setDraggedId(null);
    setDragOverId(null);
  }

  return { draggedId, dragOverId, startDrag, endDrag, enterDrag, drop };
}



void UI_Update() {
}

void OnMouseEvent(MouseEvent e) {
  if (mouseButton == RIGHT) { MoveShape(e.getX(), e.getY()); }
}

void mouseDragged(MouseEvent e) { OnMouseEvent(e); }
void mouseClicked(MouseEvent e) { OnMouseEvent(e); }
void mousePressed(MouseEvent e) { OnMouseEvent(e); }

void mouseWheel(MouseEvent event) {
  float e = event.getCount();
  float scale = e / 10.f;
  shapeScale += scale;
  shapeScale = max(.1f, shapeScale);
}

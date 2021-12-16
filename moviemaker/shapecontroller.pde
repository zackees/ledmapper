import processing.core.*;
import java.util.*;
import processing.video.*;

float shapePixelWidth;
float shapePixelHeight;
float shapeScale = 1.0;
float shapeX = canvasW / 2;
float shapeY = canvasH / 2;

final float shapeTransitionSpeed = 20.0;  // Larger is slower.

void ShapeSetup() {
  GenerateMappingShape(pixMapper);
  
  shapePixelHeight = canvasH / 2;
  shapePixelWidth = shapePixelHeight;
}

float targetshapeX = shapeX;
float targetshapeY = shapeY;
void MoveShape(float x, float y) {
  targetshapeX = x;
  targetshapeY = y;
}

void UpdateShape() {
  float diffx = targetshapeX - shapeX;
  float diffy = targetshapeY - shapeY;
  
  if (abs(diffx) < 0.5f) {
    shapeX = targetshapeX;
  } else {
    float xsign = abs(diffx) / diffx;
    diffx = abs(diffx);
    diffx = diffx / shapeTransitionSpeed;
    shapeX += (diffx * xsign);
  }
  
  if (abs(diffy) < 0.5f) {
    shapeY = targetshapeY;
  } else {
    float ysign = abs(diffy) / diffy;
    diffy = abs(diffy);
    diffy = diffy / shapeTransitionSpeed;
    shapeY += (diffy * ysign);
  }
}

List<float[]> GetPixelMap() {
  float[] centerPt = new float[] {shapeX, shapeY};
  
  float shapeW = shapePixelWidth * shapeScale;
  float shapeH = shapePixelHeight * shapeScale;
  List<float[]> pixelMap =
      pixMapper.GeneratePixelMap(centerPt, shapeW, shapeH);
  return pixelMap;
}

class PixelMatrix {
  final color[] mArray;
  final int mImgWidth; 
  PixelMatrix(color[] array, int imgWidth) {
    mArray = array;
    mImgWidth = imgWidth;
  }
  
  color xy(int x, int y) {
     int idx = x + y*mImgWidth;
     boolean inbounds = (0 <= idx) && (idx < mArray.length); 
     if (!inbounds) { return color(0, 0, 0); }
     else           { return mArray[idx]; }
  }
}

color[] GenerateColorMap(PImage frameBuffer) {
  frameBuffer.loadPixels();
  
  List<float[]> pixelMap = GetPixelMap();
  color[] output = new color[pixelMap.size()];
  
  PixelMatrix pixelMatrix = new PixelMatrix(frameBuffer.pixels, frameBuffer.width);
  //NullFilter filter = new NullFilter(pixelMatrix);
  BoxFilter filter = new BoxFilter(pixelMatrix, SamplingRadius());
  //GaussianFilter filter = new GaussianFilter(pixelMatrix, SamplingRadius(), 1.0);
  //DoubleFilter filter = new DoubleFilter(new GaussianFilter(pixelMatrix, SamplingRadius(), 1.0), SamplingRadius());
  //DoubleFilter filter = new DoubleFilter(new BoxFilter(pixelMatrix, SamplingRadius()), SamplingRadius());

  for (int i = 0; i < pixelMap.size(); ++i) {
    float[] xy = pixelMap.get(i);
    // Represents the grid coordinates.
    int x = (int)xy[0];
    int y = (int)xy[1];
    output[i] = filter.Apply(x,y);
  }
  return output;
}

int SamplingRadius() {
  return max(1, round(1.5f*shapeScale));
}

void DrawRecordingShape(PGraphics gfx) {
  gfx.fill(255);
  noStroke();
  List<float[]> pixelMap = GetPixelMap();
  for (int i = 0; i < pixelMap.size(); ++i) {
    float[] xy = pixelMap.get(i);
    float size = max(1.0f, SamplingRadius());
    gfx.ellipse(xy[0], xy[1], round(size), round(size));
  }
}

color[] lastKnownGoodColorMap = null;
void DrawOutputShape(PGraphics gfx, color[] colorMap) {
  // Hack to get consistent color when not recieving a colorMap.
  if (colorMap != null) {
    lastKnownGoodColorMap = colorMap;
  } else {
    colorMap = lastKnownGoodColorMap;
  }
  gfx.fill(32);
  gfx.stroke(128);
  int offset = 2;
  int xmin = canvasW - (canvasW/4) - offset;
  int ymin = canvasH - (canvasH/2) - offset;
  int xmax = canvasW - offset;
  int ymax = canvasH - offset;
  int w = xmax - xmin;
  int h = ymax - ymin;
  gfx.rect(xmin, ymin, w, h + 15);
  float[] centerPt = new float[]{
      .5 * (xmin + xmax),
      .5 * (ymin + ymax)
  };
  List<float[]> pixelMap =
      pixMapper.GeneratePixelMap(centerPt, w - 16, h - 16);
  noStroke();
  for (int i = 0; i < pixelMap.size(); ++i) {
    float[] xy = pixelMap.get(i);
    color c = (colorMap != null) ? colorMap[i] :
                                   color(255, 255, 255);
    gfx.fill(c);
    int size = 6;
    gfx.ellipse(xy[0], xy[1], size, size);
  }
}

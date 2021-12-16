import processing.core.*;
import java.util.*;
import processing.video.*;

float maskWidthToHeightRatio = .80f;

float maskPixelWidth;
float maskPixelHeight;
float maskScale = 1.0;
float maskX = canvasW / 2;
float maskY = canvasH / 2;

final float maskTransitionSpeed = 20.0;  // Larger is slower.

void MaskSetup() {
  GenerateMappingShape(pixMapper);
  
  maskPixelHeight = canvasH / 2;
  maskPixelWidth = maskPixelHeight * maskWidthToHeightRatio;
}

float targetMaskX = maskX;
float targetMaskY = maskY;
void MoveMask(float x, float y) {
  targetMaskX = x;
  targetMaskY = y;
}

void UpdateMask() {
  float diffx = targetMaskX - maskX;
  float diffy = targetMaskY - maskY;
  
  if (abs(diffx) < 0.5f) {
    maskX = targetMaskX;
  } else {
    float xsign = abs(diffx) / diffx;
    diffx = abs(diffx);
    diffx = diffx / maskTransitionSpeed;
    maskX += (diffx * xsign);
  }
  
  if (abs(diffy) < 0.5f) {
    maskY = targetMaskY;
  } else {
    float ysign = abs(diffy) / diffy;
    diffy = abs(diffy);
    diffy = diffy / maskTransitionSpeed;
    maskY += (diffy * ysign);
  }
  
/*
  float ysign = abs(diffy) / diffy;
  

  diffy = abs(diffy);
  

  diffy = min(5, diffy);
  

  maskY += diffy * ysign;
  */
}

List<float[]> GetPixelMap() {
  float[] centerPt = new float[] {maskX, maskY};
  
  float maskW = maskPixelWidth * maskScale;
  float maskH = maskPixelHeight * maskScale;
  List<float[]> pixelMap =
      pixMapper.GeneratePixelMap(centerPt, maskW, maskH);
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
  //BoxFilter filter = new BoxFilter(pixelMatrix, SamplingRadius());
  //GaussianFilter filter = new GaussianFilter(pixelMatrix, SamplingRadius(), 1.0);
  //DoubleFilter filter = new DoubleFilter(new GaussianFilter(pixelMatrix, SamplingRadius(), 1.0), SamplingRadius());
  DoubleFilter filter = new DoubleFilter(new BoxFilter(pixelMatrix, SamplingRadius()), SamplingRadius());

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
  return max(1, round(7.0f*maskScale));
}

void DrawRecordingMask(PGraphics gfx) {
  gfx.fill(255);
  //gfx.strokeWeight(1);
  noStroke();
  //gfx.stroke(64);
  
  List<float[]> pixelMap = GetPixelMap();
  for (int i = 0; i < pixelMap.size(); ++i) {
    float[] xy = pixelMap.get(i);

    float size = max(1.0f, SamplingRadius());
    gfx.ellipse(xy[0], xy[1], round(size), round(size));
  }
}

color[] lastKnownGoodColorMap = null;
void DrawOutputMask(PGraphics gfx, color[] colorMap) {
  
  // Hack to get consistent color when not recieving a colorMap.
  if (colorMap != null) {
    lastKnownGoodColorMap = colorMap;
  } else {
    colorMap = lastKnownGoodColorMap;
  }
  
  
  println("DrawOutputMask");
  gfx.fill(32);
  //gfx.stroke(0xFfffffff, 1.0);
  gfx.stroke(128);
  
  //int w = gfx.width;
  //int h = gfx.height;
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
  
  //float maskW = maskPixelWidth * maskScale;
  //float maskH = maskPixelHeight * maskScale;
  List<float[]> pixelMap =
      pixMapper.GeneratePixelMap(centerPt, w - 16, h - 16);
  
  

  noStroke();
  
  for (int i = 0; i < pixelMap.size(); ++i) {
    float[] xy = pixelMap.get(i);
    color c = (colorMap != null) ? colorMap[i] :
                                   color(255, 255, 255);
    gfx.fill(c);
    //gfx.fill(255);

    
    
    int size = 6;
    gfx.ellipse(xy[0], xy[1], size, size);
  }
  
}
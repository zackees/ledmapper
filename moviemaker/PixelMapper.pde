



int[] ToPixel(int x, int y) { return new int[]{x, y}; }

class PixelMapper {

  void add(int[] xy)         { add(xy[0],xy[1]); }
  void add(float x, float y) { ledMapping.add(new float[]{x, y}); }
  
  void Finalize() {
   
    if (ledMapping.size() == 0) {
      println("Error - no pixels defined for PixelMapper");
      return;
    }
    
    float minX = 999999999;
    float maxX = -999999999;
    float minY = 999999999;
    float maxY = -999999999;
   
    for (int i = 0; i < ledMapping.size(); ++i) {
      float[] xy = ledMapping.get(i);
      float x = xy[0];
      float y = xy[1];
     
      minX = min(minX, x);
      maxX = max(maxX, x);
      minY = min(minY, y);
      maxY = max(maxY, y);
    }
    
    float xScale = maxX - minX;
    float yScale = maxY - minY;
   
    // Renormalize so that width and height are exactly 1 and
    // the upper left corner is at 0,0.
    for (int i = 0; i < ledMapping.size(); ++i) {
      float[] xy = ledMapping.get(i);
      xy[0] = (xy[0] - minX) / xScale;
      xy[1] = (xy[1] - minY) / yScale;
    }
    
    // Find new center point.
    float avgx = 0.0;
    float avgy = 0.0;
    for (int i = 0; i < ledMapping.size(); ++i) {
      float[] xy = ledMapping.get(i);
      avgx += xy[0];
      avgy += xy[1];
    }
    
    avgx /= (float)ledMapping.size();
    avgy /= (float)ledMapping.size();
    
    for (int i = 0; i < ledMapping.size(); ++i) {
      float[] xy = ledMapping.get(i);
      xy[0] -= avgx;
      xy[1] -= avgy;
    }

  }
  
  // Outputs the pixel maps.
  // Note that width is the width in pixels of the generated pixel image.
  List<float[]> GeneratePixelMap(float[] centerPtXy, float generatedWidth, float generatedHeight) {
    List<float[]> output = new ArrayList<float[]>();
    
    for (int i = 0; i < ledMapping.size(); ++i) {
      float[] xy = ledMapping.get(i);
      float x = xy[0];
      float y = xy[1];
      
      x *= generatedWidth;
      x += centerPtXy[0];
      y *= generatedHeight;
      y += centerPtXy[1];
      
      output.add(new float[]{x, y});
    }
    
    return output;
  }
  
  
  
  List<float[]> ledMapping = new ArrayList<float[]>();
};

PixelMapper pixMapper = new PixelMapper();





interface Filter { color Apply(int x, int y); }

class NullFilter implements Filter {
  PixelMatrix mSrcPixels;
  NullFilter(PixelMatrix srcPixels) {
    mSrcPixels = srcPixels;
  }
  

  color Apply(int x, int y) {
    return mSrcPixels.xy(x,y);
  }
}

class BoxFilter implements Filter {
  PixelMatrix mSrcPixels;
  int mSamplingRadius;
  BoxFilter(PixelMatrix srcPixels, int sampleRadius) {
    mSrcPixels = srcPixels;
    mSamplingRadius = sampleRadius;
    
    // Convolution matrices must always be odd.
    if (mSamplingRadius % 2 == 0) {  // is even?
      // make odd by adding +1.
      mSamplingRadius++;
    }
  }

  color Apply(int x, int y) {
    int count = 0;
    
    int r = 0;
    int g = 0;
    int b = 0;
    for (int xx = x - mSamplingRadius; xx <= x + mSamplingRadius; ++xx) {
      for (int yy = y - mSamplingRadius; yy <= y + mSamplingRadius; ++yy) {
        color c = mSrcPixels.xy(xx,yy);
        r += c >> 16 & 0xff;
        g += c >> 8  & 0xff;
        b += c >> 0  & 0xff;
        count++;
      }
    }
    r /= count;
    g /= count;
    b /= count;
    
    return color(r, g, b);
  }
}

// Samples twice.
public class DoubleFilter implements Filter  {
  final Filter mFilter;
  
  final float mRadius;
  final float mHalfR;
  
  DoubleFilter(Filter f, float sampleRadius) {
    mFilter = f;
    mRadius = sampleRadius;
    mHalfR = mRadius * .5f;
  }
  

  color Apply(int x, int y) {
    color c1 = mFilter.Apply(x,(int)(y-mHalfR));
    color c2 = mFilter.Apply(x,(int)(y+mHalfR));
    
    return lerpColor(c1, c2, .5);
  }
}


public class GaussianFilter implements Filter  {

  public static final int DEFAULT_RADIUS = 5;
  public static final float DEFAULT_SIGMA = 1.f;

  public float[][] asMatrix() { return kernel; }
  //color Compute(int x, int y, 
  
  PixelMatrix mPixels;
 
  
  /** Creates a new instance of GaussianFilter */
  public GaussianFilter(PixelMatrix srcPixels,
                       int r,
                       float s) {
    mPixels = srcPixels;
    

    
    mDiameter = r * 2 - 1;
    sigma = s;
    kernel = makeKernel();
  }
  
  
  
  private float[][] makeKernel() {
    double[] flatKernel = new double[mDiameter * mDiameter];
    double sum = 0;
    for (int y = 0; y < mDiameter; y++) {
      for (int x = 0; x < mDiameter; x++) {
        int off = y * mDiameter + x;
        int xx = x - mDiameter / 2;
        int yy = y - mDiameter / 2;
        flatKernel[off] = (double) Math.pow(Math.E, -(xx * xx + yy * yy)
                        / (2 * (sigma * sigma)));
        sum += flatKernel[off];
      }
    }
    for (int i = 0; i < flatKernel.length; i++)
      flatKernel[i] /= sum;
            
            
    float[][] output = new float[mDiameter][mDiameter];
    for (int x = 0; x < mDiameter; x++) {
      for (int y = 0; y < mDiameter; y++) {
        output[x][y] = (float)flatKernel[y * mDiameter + x];
      }
      System.out.println();
    }
    
    return output;
  }
  
  color Apply(int x, int y) {    
    float r = 0;
    float g = 0;
    float b = 0;
    
    int radius = mDiameter / 2;
    
    int cx = 0;
    for (int xx = x - radius; xx <= x + radius; ++xx) {

      int cy = 0;
      for (int yy = y - radius; yy <= y + radius; ++yy) {
        
        float weight = asMatrix()[cx][cy];
        //float weight = 1.0f/((float)radius*(float)radius);
        
        color c = mPixels.xy(xx,yy);
        r += (c >> 16 & 0xff) * weight;
        g += (c >> 8  & 0xff) * weight;
        b += (c >> 0  & 0xff) * weight;
        ++cy;
      }
      ++cx;
    }
    
    if (cx != mDiameter) {
      println("bad cx!!!!!!!, is " + cx);
    }
    
    //if (cy != mDiameter) {
    //  println("bad cy!!!!!!!, is " + cy);
    //}
    
    return color((int)r, (int)g, (int)b);
  }
  

  
  private int mDiameter;
  private float sigma;
  private float[][] kernel;
}

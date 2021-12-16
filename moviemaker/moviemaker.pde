import g4p_controls.*;
import javax.swing.*; 
import de.bezier.guido.*;
import java.awt.Point;


import processing.core.*;
import java.util.*;
import processing.video.*;

int canvasW = 800;
int canvasH = 480;
boolean isRecording = false;

 //<>//
// Src Movie section. currFrame is the current
// frame of the movie.
Movie srcMovie;
List<PImage> fifoMovieFrames = new ArrayList<PImage>();
PImage lastGoodMovieFrame = null;
OutputStream outputFile;

void setup() {
  background(0);
  size(800, 600, P3D);
 
  
  frameRate(60);
  background(0);

  //noSmooth();
  smooth(2);

  GuiSetup();
  MaskSetup();
}


// Called every time a new frame is available to read
void movieEvent(Movie m) {
  // We do nothing because we want the renderer to pull the movie.
  m.read();
  PImage img = m;
  fifoMovieFrames.add(img);
}

class FrameInfo { PImage currFrame = null; boolean isNew = false; }

FrameInfo PopMovieFrame() {
  FrameInfo info = new FrameInfo();

  if (fifoMovieFrames.isEmpty()) {
    info.isNew = false;
    info.currFrame = lastGoodMovieFrame;
    return info;
  }

  info.currFrame = fifoMovieFrames.get(0);
  fifoMovieFrames.remove(0);

  lastGoodMovieFrame = info.currFrame;
  info.isNew = true;
  
  if (info.currFrame == null) {
    println("Unexpected null frame");
  }

  return info;
} 

void CompositeMovieFrame(PGraphics gfx, PImage img) {
  
  float scalex = (float)canvasW / (float)img.width;
  float scaley = (float)canvasH / (float)img.height;
  
  float finalScale = min(scalex, scaley);
  
  background(0);
  gfx.image(img, 0, 0,
            finalScale * img.width,
            finalScale * img.height);
}


void draw() {
  // No graphics context means no draw.
  if (this.g == null) { return; }

  
  UI_Update();
  UpdateMask();

  FrameInfo frameInfo = PopMovieFrame();
  
  background(0);
  if (frameInfo.currFrame != null) {
    CompositeMovieFrame(this.g, frameInfo.currFrame);
  }
  
  // Simple case, just display stuff so that the user can see what's happening.
  if (!isRecording) {
    DrawRecordingMask(this.g);
    return;
  }
  // Output array of pixels.
  color[] colorMap = null;
   // Only record when there are new frames.
  if (isRecording && frameInfo.isNew) {    
    colorMap = GenerateColorMap(get());

    if (outputFile == null) {
      println("outputFile is unexpectadly null!");
    }
    
    // We borrwow the APA102 format for data transmission.
    // Enough data to hold every pixel (promote to 4 bytes) +
    // draw cmd.
    List<Byte> bytesLst = new ArrayList<Byte>();
    // Encode into data stream.
    for (int i = 0; i < colorMap.length; ++i) {
      color c = colorMap[i];
      byte ctr = (byte)0xff;  // Specifies that this is pixel data.
      byte r = (byte)((c >> 16) & 0xff);
      byte g = (byte)((c >> 8)  & 0xff);
      byte b = (byte)((c >> 0)  & 0xff);
      bytesLst.add(ctr);
      bytesLst.add(r);
      bytesLst.add(g);
      bytesLst.add(b);
    }

    // Add 4 bytes to the buffer which signals draw.
    for (int i = 0; i < 4; ++i) { bytesLst.add((byte)0); }
    
    byte[] byteArray = new byte[bytesLst.size()];
    
    for (int i = 0; i < bytesLst.size(); ++i) {
      byteArray[i] = bytesLst.get(i);
    }
    
    try {
      outputFile.write(byteArray);
      outputFile.flush();
    } catch (IOException e) {
      println("ERROR ");
      e.printStackTrace();
    }
  }

  DrawRecordingMask(this.g);
  
  // We can draw the output from the mask!
  DrawOutputMask(this.g, colorMap);
}

void stop()
{
  super.stop();
}

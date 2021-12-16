import de.bezier.guido.*;

PFont font;
SimpleButton pausePlay;
SimpleButton loadBtn;

void GuiSetup() {

    Interactive.make( this );
    
    
    loadBtn =
      new SimpleButton("Load Src",
                       new LoadSrcFileCallback(),
                       0, 0, 60, 20);
    loadBtn.SetChangesColor(false);
    
    
    pausePlay =
      new SimpleButton(">",
                       new TogglePlayPauseCallback(),
                       70, 0, 18, 20);
    pausePlay.SetChangesColor(false);
    
    font = createFont("Arial",16,true);
}

void GuiUpdate() {
}


class Callback {
  void OnCallback(SimpleButton btn) {}
}

class LoadSrcFileCallback extends Callback {
  void OnCallback(SimpleButton btn) {
    srcMovie = null;    // reset these guys so that we can load in different movies.
    outputFile = null;
    PromptUserToSelectSrcMovieFile();
  }
}

class TogglePlayPauseCallback extends Callback {
  void OnCallback(SimpleButton btn) {
    if (srcMovie == null) {
      PromptUserToSelectSrcMovieFile();
      btn.on = false;
      return;
    }
    
    if (outputFile == null) {
      PromptUserToSelectDataOutput();
      btn.on = false;
      return;
    }
    

    if (btn.on) { srcMovie.play();  btn.mLabel = ">";  }
    else        { srcMovie.pause(); btn.mLabel = "||"; }

    isRecording = btn.on;
  }
}

public class SimpleButton
{
    float x, y, width, height;
    boolean on;
    boolean mChangesColor = true;
    String mLabel;
    
    Callback mCallback;
    
    SimpleButton (String label, Callback callback,
                  float xx, float yy, float w, float h )
    {
        mLabel = label;
        x = xx; y = yy; width = w; height = h;
        mCallback = callback;
        
        Interactive.add( this ); // register it with the manager
    }
    
    void SetChangesColor(boolean on) {
        mChangesColor = on;
    }
    
    // called by manager
    
    void mousePressed ( float mx, float my ) 
    {
        on = !on;
        mCallback.OnCallback(this);
    }

    void draw () 
    {

        boolean paintActivated = (on && mChangesColor);
      
        int background = paintActivated ? 200 : 100;
        int textColor = paintActivated ? 50 : 250;
      
        fill(background);

        rect(x, y, width, height);
        
        //textAlign(CENTER);
        //rectMode(RADIUS);
        fill(textColor);
        textSize(12);
        text(mLabel, x + 5, y + 15); 
    }
}



void PromptUserToSelectSrcMovieFile() {
    selectInput("Select src movie: ", "onSrcMovieFileSelected");
}

void PromptUserToSelectDataOutput() {
    selectOutput("Select a destination for video.dat:", "onDestDataFileSelected");
}


void onSrcMovieFileSelected(File selection) {
  
  if (selection == null) {
  } else {
    println("Movie selected " + selection.getAbsolutePath());

    srcMovie = new Movie(this, selection.getAbsolutePath());
  }
}


void onDestDataFileSelected(File selection) {
  
  if (selection == null) {
  } else {
    println("Output Movie selected " + selection.getAbsolutePath());
    outputFile = createOutput(selection.getAbsolutePath());

    //SetDestinationFile(selection.getAbsolutePath());
    //mSrcMovie.play();
    
    //dstMovie
  }
}
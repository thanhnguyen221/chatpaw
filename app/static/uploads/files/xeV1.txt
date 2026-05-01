//
#include <SoftwareSerial.h>
SoftwareSerial mySerial(2, 3); // RX, TX


const int relay = 12;
const int motorB1  = 5;    
const int motorB2  = 6;   
const int motorA1  = 9;  
const int motorA2  = 10;  
//const int buzzer = 10 ;   
const int BTState = 8;    
int i = 0;
int j = 0;
int state_rec;
int vSpeed = 200;   
char state;

void setup() {

  pinMode(motorA1, OUTPUT);
  pinMode(motorA2, OUTPUT);
  pinMode(motorB1, OUTPUT);
  pinMode(motorB2, OUTPUT);
//  pinMode(buzzer, OUTPUT);
  pinMode(BTState, INPUT);
  pinMode(motorA1, OUTPUT);
  pinMode(relay, OUTPUT);
  Serial.begin(9600);
  mySerial.begin(9600);
  Serial.println("OK");
  
}

void loop() {

  if(mySerial.available())
   {
     state = mySerial.read();
     Serial.println(state);
   }

  //if (digitalRead(BTState) == LOW) {
  //  state_rec = 'S';
  //}


  if (state == '0') {
    vSpeed = 0;
  }
  else if (state == '4') {
    vSpeed = 100;
  }
  else if (state == '6') {
    vSpeed = 155;
  }
  else if (state == '7') {
    vSpeed = 180;
  }
  else if (state == '8') {
    vSpeed = 200;
  }
  else if (state == '9') {
    vSpeed = 230;
  }
  else if (state == 'q') {
    vSpeed = 255;
  }

  if (state != 'S') {
    Serial.print(state);
  }


  if (state == 'F') {
    analogWrite(motorB1, vSpeed);
    analogWrite(motorA1, vSpeed);
    analogWrite(motorA2, 0);
    analogWrite(motorB2, 0);
  }

    else if (state == 'G') {  
    analogWrite(motorA1, vSpeed); 
    analogWrite(motorA2, 0);
    analogWrite(motorB1, 100);    
    analogWrite(motorB2, 0);
  }

    else if (state == 'I') {   
    analogWrite(motorA1, 100); 
    analogWrite(motorA2, 0);
    analogWrite(motorB1, vSpeed);      
    analogWrite(motorB2, 0);
  }

  else if (state == 'B') { 
    analogWrite(motorA1, 0);
    analogWrite(motorB1, 0);
    analogWrite(motorB2, vSpeed);
    analogWrite(motorA2, vSpeed);
  }

   else if (state == 'H') {  
    analogWrite(motorA1, 0);   
    analogWrite(motorA2, vSpeed);
    analogWrite(motorB1, 0); 
    analogWrite(motorB2, 100);
  }
  
  else if (state == 'J') {  
    analogWrite(motorA1, 0);   
    analogWrite(motorA2, 100);
    analogWrite(motorB1, 0);   
    analogWrite(motorB2, vSpeed);
  }

  else if (state == 'R') {   
    analogWrite(motorA1, 0);
    analogWrite(motorA2, vSpeed);
    analogWrite(motorB1, vSpeed);
    analogWrite(motorB2, 0);
  }
  else if (state == 'L') {   
    analogWrite(motorA1, vSpeed);
    analogWrite(motorA2, 0);
    analogWrite(motorB1, 0);
    analogWrite(motorB2, vSpeed);
  }
  else if (state == 'S') {   
    analogWrite(motorA1, 0);
    analogWrite(motorA2, 0);
    analogWrite(motorB1, 0);
    analogWrite(motorB2, 0);
  }


//  else if (state == 'V') { 
//    if (j == 0) {
//      digitalWrite(relay, HIGH);
//      Serial.println("b");
//      j = 1;
//    }
//    else if (j == 1) {
//      digitalWrite(relay, LOW);
//      Serial.println("t");
//      j = 0;
//    }
//// state = 'n';
//  }

if (state == 'X') {
   digitalWrite(relay, HIGH); 
  }
  else if (state == 'x') {
  digitalWrite(relay, LOW);
  }
}

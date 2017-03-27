'use strict';

// dependencies
const awsIot = require('aws-iot-device-sdk');

/**
 * Called when the session starts.
 */
const queue = {};

function createDevice(requestId) {
  const device = awsIot.device({
    keyPath: 'lumiere-private.pem.key',
    certPath: 'lumiere-certificate.pem.crt',
    caPath: 'root_CA.crt',
    clientId: `lumiere_lambda_${requestId}`,
    region: 'us-east-1'
  });

  device
    .on('connect', function() {
      console.log('connect');
      device.subscribe('rpi-responses');
    });

  device
    .on('message', function(topic, payload) {
      console.log(`${topic}: ${payload.toString()}`);
      if (topic === 'rpi-responses') {
        const message = JSON.parse(payload.toString());
        console.log('Received message, queue[requestId] = ', queue[message.requestId]);
        if (message.success === true && queue[message.requestId]) {
          queue[message.requestId](message.value); 
          queue[message.requestId] = null;
        }
      }
    });

    return device;
};

// --------------- Helpers that build all of the responses -----------------------

function buildSpeechletResponse(title, output, repromptText, shouldEndSession) {
  return {
    outputSpeech: {
      type: 'PlainText',
      text: output,
    },
    card: {
      type: 'Simple',
      title: `${title}`,
      content: `${output}`,
    },
    reprompt: {
      outputSpeech: { 
        type: 'PlainText',
        text: repromptText,
      },
    },
    shouldEndSession,
  };
}

function buildResponse(sessionAttributes, speechletResponse) {
  return {
    version: '1.0',
    sessionAttributes,
    response: speechletResponse,
  };
}

// --------------- Functions that control the skill's behavior -----------------------

function getWelcomeResponse(callback) {
  // If we wanted to initialize the session to have some attributes we could add those here.
  const sessionAttributes = {};
  const cardTitle = 'Welcome';
  const speechOutput = 'Welcome to Lumiere! Please set or ask for the lighting level in a room.';
  // If the user either does not reply to the welcome message or says something that is not
  // understood, they will be prompted again with this text.
  const repromptText = 'Please set or ask for the lighting level in a room.';
  const shouldEndSession = false;

  callback(sessionAttributes,
      buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function handleSessionEndRequest(callback) {
  const cardTitle = 'Session Ended';
  const speechOutput = 'Thank you for trying Lumiere. Have a nice day!';
  // Setting this to true ends the session and exits the skill.
  const shouldEndSession = true;

  callback({}, buildSpeechletResponse(cardTitle, speechOutput, null, shouldEndSession));
}

function getLightLevel(intent, session, callback) {
  const cardTitle = 'Get Light Level';
  const roomSlot = intent.slots.Room;
  let repromptText = '';
  const sessionAttributes = {};
  let shouldEndSession = false;
  let speechOutput = '';

  if (roomSlot) { 
    const room = roomSlot.value;
    console.log('Calling getLightLevelForRoom');
    getLightLevelForRoom(room, intent.requestId)
      .then(lightLevelString => {
        speechOutput = `${room} is ${lightLevelString}. You can ask me to change this if you want.`;
        repromptText = `You can ask me to change the light level in any room if you want.`;
        shouldEndSession = true;
        console.log(lightLevelString);
        callback(sessionAttributes,
          buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
      });
  } else {
    console.log('Unable to determine the correct room.');
    speechOutput = `I'm not sure which room you were asking about. Please try again.`;
    repromptText = `I'm not sure which room you were asking about.`;
    callback(sessionAttributes,
      buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
  }
}

function setLightLevel(intent, session, callback) {
  const cardTitle = 'Set Light Level';
  const roomSlot = intent.slots.Room;
  const amountSlot = intent.slots.Amount;
  const modifierSlot = intent.slots.Modifier;
  const percentageSlot = intent.slots.Percentage;
  let repromptText = '';
  const sessionAttributes = {};
  let shouldEndSession = false;
  let speechOutput = '';

  if (roomSlot) {
    const room = roomSlot.value;
    let amount = null;
    let modifier = null;
    let percentage = null;

    if (amountSlot) {
        amount = amountSlot.value;
    }
    if (modifierSlot) {
        modifier = modifierSlot.value;
    }
    if (percentageSlot) {
        percentage = percentageSlot.value;
    }

    setLightLevelForRoom(room, amount, modifier, percentage, intent.requestId);

    speechOutput = `Successfully set the light level for room ${room}. You can ask me to change this if you want.`;
    repromptText = `You can ask me to change the light level in any room if you want.`;
    shouldEndSession = true;
  } else {
    speechOutput = `I'm not sure which room you wanted me to adjust. Please try again.`;
    repromptText = `I'm not sure which room you wanted me to adjust.`;
  }

  callback(sessionAttributes,
    buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function changeLightLevel(intent, session, callback, direction) {
  const cardTitle = 'Change Light Level';
  const roomSlot = intent.slots.Room;
  const amountSlot = intent.slots.ChangeAmount;
  const modifierSlot = intent.slots.ChangeModifier;
  let repromptText = '';
  const sessionAttributes = {};
  let shouldEndSession = false;
  let speechOutput = '';

  if (roomSlot) {
    const room = roomSlot.value;
    let amount = null;
    let modifier = null;

    if (amountSlot) {
        amount = amountSlot.value;
    }
    if (modifierSlot) {
        modifier = modifierSlot.value;
    }

    changeLightLevelForRoom(room, amount, modifier, direction, intent.requestId).then(function(success){
      if (success){
        speechOutput = `Successfully changed the light level for room ${room}. You can ask me to change this if you want.`;
        repromptText = `You can ask me to change the light level in any room if you want.`;
      } else {
        speechOutput = `Failed to change the light level for room ${room}. You can ask me to change this if you want.`;
        repromptText = `You can ask me to change the light level in any room if you want.`;
      }
      shouldEndSession = true;
      callback(sessionAttributes,
          buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
    });


  } else {
    speechOutput = `I'm not sure which room you wanted me to adjust. Please try again.`;
    repromptText = `I'm not sure which room you wanted me to adjust.`;
    callback(sessionAttributes,
      buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
  }

  callback(sessionAttributes,
    buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

// --------------- Events -----------------------

function onSessionStarted(sessionStartedRequest, session) {
  console.log(`onSessionStarted requestId=${sessionStartedRequest.requestId}, sessionId=${session.sessionId}`);
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(launchRequest, session, callback) {
  console.log(`onLaunch requestId=${launchRequest.requestId}, sessionId=${session.sessionId}`);

  // Dispatch to your skill's launch.
  getWelcomeResponse(callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, session, callback) {
  console.log(`onIntent requestId=${intentRequest.requestId}, sessionId=${session.sessionId}`);

  const intent = intentRequest.intent;
  intent.requestId = intentRequest.requestId;
  const intentName = intentRequest.intent.name;

  // Dispatch to your skill's intent handlers
  if (intentName === 'GetLightLevel') {
    getLightLevel(intent, session, callback);
  } else if (intentName === 'SetLightLevel') {
    setLightLevel(intent, session, callback);
  } else if (intentName === 'IncreaseLightLevel') {
    changeLightLevel(intent, session, callback, 1);
  } else if (intentName === 'DecreaseLightLevel') {
    changeLightLevel(intent, session, callback, -1);
  } else if (intentName === 'AMAZON.HelpIntent') {
    getWelcomeResponse(callback);
  } else if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
    handleSessionEndRequest(callback);
  } else {
    throw new Error('Invalid intent');
  }
}

/**
 * Called when the user ends the session.
 * Is not called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(sessionEndedRequest, session) {
  console.log(`onSessionEnded requestId=${sessionEndedRequest.requestId}, sessionId=${session.sessionId}`);
  // Add cleanup logic here
}

//FIS related functions
function FuzzySet(center, membership_function, inverse_membership_function) {
	this.center = center;
	this.membership_function = membership_function;
	this.inverse_membership_function = inverse_membership_function;
}

const MODIFIER_DEVIATION = {
	very: 0,
	moderately: 1/6,
	somewhat: 1/3,
	slightly: 0.5
};

const BRIGHTNESS_FUZZY_SETS = {
	dark: new FuzzySet(0, function(x) {
		if (x>=0 && x<=25){
			return 1 - x / 25;
		} else {
			return 0;
		}
	}, function(modifier) {
		const deviation = MODIFIER_DEVIATION[modifier];
		const y = 1 - deviation;
		return 25 - 25 * y;
	}),
	dim: new FuzzySet(25, function(x) { //a.k.a low
		if (x > 25 && x <= 50) {
			return 2-x/25;
		} else if (x>=0 && x<=25) {
			return  x/25;
		} else {
			return 0;
		}
	}, function(modifier) {
		const deviation = MODIFIER_DEVIATION[modifier];
		const y = 1 - deviation;
		return 50 - 25 * y;
	}),
	medium: new FuzzySet(50, function(x) {
		if (x > 50 && x <= 75) {
			return 3-x/25;
		} else if (x>=25 && x<=50) {
			return  x/25 - 1;
		} else {
			return 0;
		}
	}, function(modifier) {
		return 50;
	}),
	high: new FuzzySet(75, function(x) {
		if (x > 75 && x <= 100) {
			return 4-x/25;
		} else if (x>=50 && x<=75) {
			return  x/25 - 2;
		} else {
			return 0;
		}
	}, function(modifier) {
		const deviation = MODIFIER_DEVIATION[modifier];
		const y = 1 - deviation;
		return 50 + 25 * y;
	}),
	bright: new FuzzySet(100, function(x) {
		if (x>=75 && x<=100){
			return  x/25 - 3;
		} else {
			return 0;
		}
	}, function(modifier) {
		const deviation = MODIFIER_DEVIATION[modifier];
		const y = 1 - deviation;
		return 75 + 25 * y;
	})
}

const CHANGE_AMOUNT = {
	bit: 10,
	little: 10, 
	tad: 10,
	bunch: 25, 
	lot: 50,
	amount: 25, 
	some: 25,
	amply: 25,
	colossaly: 75,
	enormously: 75,
	gargantuanly: 75,
	gigantically: 75,
	greatly: 50,
	hugely: 50,
	humongously: 75,
	immensely: 75,
	largely: 50,
	massively: 75,
	prodigiously: 75,
	sizably: 50,
	substantially: 50,
	tremendously: 75,
	vastly: 75,
	much: 50,
	moderately: 25,
	somewhat: 10,
	minutely: 10,
	punily: 5,
	slightly: 5,
	tinily: 5
};

//percentages
const CHANGE_MODIFIER = {
	little: 100,
	miniscule: 50,
	minute: 50,
	puny: 50,
	slight: 50,
	small: 50,
	tiny: 50,
	teeny: 50,
	teensy: 50,
	wee: 50,
	ample: 150,
	big: 200,
	colossal: 250,
	enormous: 250,
	gargantuan: 250,
	gigantic: 250,
	great: 200,
	huge: 200,
	humongous: 250,
	immense: 250,
	large: 200,
	massive: 200,
	prodigious: 250,
	sizable: 150,
	substantial: 150,
	tremendous: 250,
	vast: 250,
	very: 100,
	fair: 100,
	intermediate: 150,
	medium: 100,
	middling: 10,
	moderate: 100
};

const ROOM_NAME_TO_NUM = {
	[`room one`]: 0,
	[`room one's`]: 0,
	[`room two`]: 1,
	[`room two's`]: 1,
	[`room three`]: 2,
	[`room three's`]: 2,
  [`room 1`]: 0,
  [`room 1's`]: 0,
  [`room 2`]: 1,
  [`room 2's`]: 1,
  [`room 3`]: 2,
  [`room 3's`]: 2,
	[`first room`]: 0,
	[`first room's`]: 0,
	[`the first room`]: 0,
	[`the first room's`]: 0,
	[`second room`]: 1,
	[`second room's`]: 1,
	[`the second room`]: 1,
	[`the second room's`]: 1,
	[`third room`]: 2,
	[`third room's`]: 2,
	[`the third room`]: 2,
	[`the third room\'s`]: 2,
  [`1st room`]: 0,
  [`1st room's`]: 0,
  [`the 1st room`]: 0,
  [`the 1st room's`]: 0,
  [`2nd room`]: 1,
  [`2nd room's`]: 1,
  [`the 2nd room`]: 1,
  [`the 2nd room's`]: 1,
  [`3rd room`]: 2,
  [`3rd room's`]: 2,
  [`the 3rd room`]: 2,
  [`the 3rd room's`]: 2
};

//returns light level between 0 to 100
function getNumericalLightLevelForRoom(room, requestId) {
  return new Promise((resolve, reject) => {
    const device = createDevice(requestId);

    const timeout = setTimeout(() => {
      if (queue[requestId]) {
        device.end();
        queue[requestId] = null;
        reject(`Request with id ${requestId} timed out.`);
      }
    }, 4500);

    queue[requestId] = function(rawLightLevel) {
      console.log('Calling callback queue function.');
      clearTimeout(timeout);
      device.end();
      const normalizedLightLevel = Math.min(1000, rawLightLevel)/10;
      resolve(normalizedLightLevel);
    };

    device.publish('lighter-queries', JSON.stringify({
      requestId: requestId,
      room: ROOM_NAME_TO_NUM[room],
      action: 'GET'
    }));
  });
}

function getMembershipsForLightLevel(numericalLightLevel) {
	//light_level between 0 to 100
	const memberships = [];
	for (const key in BRIGHTNESS_FUZZY_SETS){
		const membership = BRIGHTNESS_FUZZY_SETS[key].membership_function(numericalLightLevel);
		if (membership > 0){
			memberships.push([key, membership]);
		}
	}
	return memberships;
}

function getLightLevelForRoom(room, requestId) {
  return getNumericalLightLevelForRoom(room, requestId)
    .then(numericalLightLevel => {
      console.log(`Numerical light level for room is ${numericalLightLevel}`);
      const normalizedLightLevel = Math.min(1000, numericalLightLevel)/10;
      const memberships = getMembershipsForLightLevel(normalizedLightLevel);
      memberships.sort(function(a, b){return b[1]-a[1];}); //sort in descending order
      return memberships.map(function(element){return element[0]}).join(" ");
    });
    //TODO add .catch function
}

function setLightLevelForRoom(room, target, modifier, percentage, requestId) { 
	if (target != null) {
		if (target == 'low') {
			target = 'dim';
		} else if (target == 'on') {
			target = 'high';
			modifier = 'somewhat';
		} else if (target == 'off') {
			target = 'dark';
			modifier = 'very';
		}
		if (modifier === null) {
			modifier = 'moderately'	
		}
		percentage = BRIGHTNESS_FUZZY_SETS[target].inverse_membership_function(modifier);
	} else if (percentage == null){
		//no target and no percentage,
		//TODO throw an error or set to default brightness
		percentage = 50;
	}
	return getNumericalLightLevelForRoom(room).then(function(numericalLightLevel){
  	const memberships = getMembershipsForLightLevel(numericalLightLevel);
  	var delta_percentage = 0;
  	memberships.forEach(function(membership) {
  		const name = membership[0];
  		const weight = membership[1];
  		delta_percentage += weight * (percentage - BRIGHTNESS_FUZZY_SETS[name].center);
  	});
  	//TODO set the actual light level with delta, check for NaN
  	return sendLightLevelChange(room, delta_percentage, requestId);
	});

}

function changeLightLevelForRoom(room, change_amount, change_modifier, direction, requestId) {
	const delta_percentage = CHANGE_AMOUNT[change_amount] * CHANGE_MODIFIER[change_modifier] / 100 * direction;
	//TODO set the actual light level with delta, check for NaN
	return sendLightLevelChange(room, delta_percentage, requestId);
};

function sendLightLevelChange(room, delta_percentage, requestId){
  var delta = delta_percentage / 100 * 30;
  return new Promise((resolve, reject) => {
    const device = createDevice(requestId);

    const timeout = setTimeout(() => {
      if (queue[requestId]) {
        device.end();
        queue[requestId] = null;
        reject(`Request with id ${requestId} timed out.`);
      }
    }, 4500);

    queue[requestId] = function(response) {
      console.log('Calling callback queue function.');
      clearTimeout(timeout);
      device.end();
      resolve(response);
    };

    device.publish('lighter-queries', JSON.stringify({
      requestId: requestId,
      room: ROOM_NAME_TO_NUM[room],
      action: 'OFFSET',
      value: Math.round(delta)
    }));
  });
}
// --------------- Main handler -----------------------

// Route the incoming request based on type (LaunchRequest, IntentRequest,
// etc.) The JSON body of the request is provided in the event parameter.
exports.handler = (event, context, callback) => {
  try {
    console.log(`event.session.application.applicationId=${event.session.application.applicationId}`);

    if (event.session.application.applicationId !== 'amzn1.ask.skill.e417dffb-16cb-4536-852b-afc2623718b4') {
      callback('Invalid Application ID');
    }

    if (event.session.new) {
      onSessionStarted({ requestId: event.request.requestId }, event.session);
    }

    if (event.request.type === 'LaunchRequest') {
      onLaunch(event.request,
        event.session,
        (sessionAttributes, speechletResponse) => {
          callback(null, buildResponse(sessionAttributes, speechletResponse));
        });
    } else if (event.request.type === 'IntentRequest') {
      onIntent(event.request,
        event.session,
        (sessionAttributes, speechletResponse) => {
          callback(null, buildResponse(sessionAttributes, speechletResponse));
        });
    } else if (event.request.type === 'SessionEndedRequest') {
      onSessionEnded(event.request, event.session);
      callback();
    }
  } catch (err) {
    callback(err);
  }
};
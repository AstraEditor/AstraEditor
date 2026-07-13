const SET_PROPORTIONAL = 'scratch-paint/proportional-shape/SET_PROPORTIONAL';
const TOGGLE_PROPORTIONAL = 'scratch-paint/proportional-shape/TOGGLE_PROPORTIONAL';
const initialState = false;

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_PROPORTIONAL:
        return action.proportional;
    case TOGGLE_PROPORTIONAL:
        return !state;
    default:
        return state;
    }
};

// Action creators ==================================
const setProportionalShape = function (proportional) {
    return {
        type: SET_PROPORTIONAL,
        proportional: proportional
    };
};

const toggleProportionalShape = function () {
    return {
        type: TOGGLE_PROPORTIONAL
    };
};

export {
    reducer as default,
    setProportionalShape,
    toggleProportionalShape
};

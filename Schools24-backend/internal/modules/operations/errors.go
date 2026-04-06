package operations

import "errors"

// ErrEventNotFound indicates event is missing for the tenant.
var ErrEventNotFound = errors.New("event not found")

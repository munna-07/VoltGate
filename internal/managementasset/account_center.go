package managementasset

import _ "embed"

//go:embed assets/account-center.html
var accountCenterHTML string

// AccountCenterHTML returns the embedded account management dashboard.
func AccountCenterHTML() string {
	return accountCenterHTML
}

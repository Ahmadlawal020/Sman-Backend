const { relations } = require("drizzle-orm");
const {
  consumerOrder,
  consumerOrderauditevent,
  administrationUser,
  consumerTruckallocation,
  consumerOrderproduct,
  consumerStates,
  administrationOfflinesales,
  administrationOfflinesalesTrucks,
  consumerTruck,
  administrationUserGroups,
  authGroup,
  administrationUserUserPermissions,
  authPermission,
  administrationOfflinesalesproduct,
  consumerProduct,
  authtokenToken,
  deliveryLedgerSettings,
  administrationDeliveryledgersettingsaudit,
  consumerProductprice,
  administrationDeliveryinventory,
  administrationDeliveryinventoryTrucks,
  consumerFleettruck,
  consumerAuditlog,
  djangoContentType,
  authGroupPermissions,
  authUserGroups,
  authUser,
  authUserUserPermissions,
  consumerDeliveryorders,
  consumerBankacct,
  consumerPfi,
  consumerPickuporders,
  consumerPickuptruck,
  consumerBankstatementcolumnmapping,
  consumerOrderpaymentinfo,
  consumerPaymentchannels,
  administrationDailyreportapproval,
  consumerOrderpaymentrecord,
  djangoAdminLog,
  administrationStaffdailysalesreport,
  consumerAgent,
  consumerPfimovement,
  consumerTruckbreakdown,
  consumerFleetledgerentry,
  administrationUserLocations,
  administrationUserPfis,
  administrationRecord,
  consumerOverpaymenttransferrequest,
  administrationDeliverycustomer,
  consumerLpgplant,
  consumerLpgstockentry,
  consumerPaymentsplit,
  consumerLpgsale,
  consumerCustomer,
  consumerTruckticket,
  administrationDeliverysale,
  consumerPfiAllowedLocations,
  administrationConfirmrelease,
  consumerPaymentfile,
  djangoCeleryBeatCrontabschedule,
  djangoCeleryBeatPeriodictask,
  djangoCeleryBeatIntervalschedule,
  djangoCeleryBeatSolarschedule,
  djangoCeleryBeatClockedschedule,
  consumerBankstatement,
  consumerBankstatementline,
  consumerLocationcommissionrate,
  administrationUserLpgPlants,
  administrationUserFillingStations,
  administrationUsertoken,
  consumerPfiexpense,
  consumerExpensecategory,
  consumerPfiexpenseaudit,
  consumerPfiexpenseattachment,
} = require("./schema");

const consumerOrderauditeventRelations = relations(consumerOrderauditevent, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerOrderauditevent.orderId],
		references: [consumerOrder.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerOrderauditevent.actorUserId],
		references: [administrationUser.id]
	}),
}));

const consumerOrderRelations = relations(consumerOrder, ({one, many}) => ({
	consumerOrderauditevents: many(consumerOrderauditevent),
	consumerTruckallocations: many(consumerTruckallocation),
	consumerAuditlogs: many(consumerAuditlog),
	consumerDeliveryorders: many(consumerDeliveryorders),
	consumerOrderproducts: many(consumerOrderproduct),
	consumerOrderpaymentinfos: many(consumerOrderpaymentinfo),
	consumerOrderpaymentrecords: many(consumerOrderpaymentrecord),
	consumerPickuporders: many(consumerPickuporders),
	consumerPfimovements: many(consumerPfimovement),
	consumerTruckbreakdowns: many(consumerTruckbreakdown),
	consumerOverpaymenttransferrequests_sourceOrderId: many(consumerOverpaymenttransferrequest, {
		relationName: "consumerOverpaymenttransferrequest_sourceOrderId_consumerOrder_id"
	}),
	consumerOverpaymenttransferrequests_targetOrderId: many(consumerOverpaymenttransferrequest, {
		relationName: "consumerOverpaymenttransferrequest_targetOrderId_consumerOrder_id"
	}),
	consumerPaymentsplits: many(consumerPaymentsplit),
	administrationUser_paymentConfirmedById: one(administrationUser, {
		fields: [consumerOrder.paymentConfirmedById],
		references: [administrationUser.id],
		relationName: "consumerOrder_paymentConfirmedById_administrationUser_id"
	}),
	administrationUser_releasedById: one(administrationUser, {
		fields: [consumerOrder.releasedById],
		references: [administrationUser.id],
		relationName: "consumerOrder_releasedById_administrationUser_id"
	}),
	administrationUser_securityExitedById: one(administrationUser, {
		fields: [consumerOrder.securityExitedById],
		references: [administrationUser.id],
		relationName: "consumerOrder_securityExitedById_administrationUser_id"
	}),
	consumerCustomer: one(consumerCustomer, {
		fields: [consumerOrder.userId],
		references: [consumerCustomer.id]
	}),
	consumerState: one(consumerStates, {
		fields: [consumerOrder.stateId],
		references: [consumerStates.id]
	}),
	consumerAgent: one(consumerAgent, {
		fields: [consumerOrder.assignedAgentId],
		references: [consumerAgent.id]
	}),
	consumerPfi: one(consumerPfi, {
		fields: [consumerOrder.pfiId],
		references: [consumerPfi.id]
	}),
	administrationUser_ticketGeneratedById: one(administrationUser, {
		fields: [consumerOrder.ticketGeneratedById],
		references: [administrationUser.id],
		relationName: "consumerOrder_ticketGeneratedById_administrationUser_id"
	}),
	administrationUser_commissionPaidById: one(administrationUser, {
		fields: [consumerOrder.commissionPaidById],
		references: [administrationUser.id],
		relationName: "consumerOrder_commissionPaidById_administrationUser_id"
	}),
	administrationUser_securityEnteredById: one(administrationUser, {
		fields: [consumerOrder.securityEnteredById],
		references: [administrationUser.id],
		relationName: "consumerOrder_securityEnteredById_administrationUser_id"
	}),
	consumerTrucktickets: many(consumerTruckticket),
	administrationConfirmreleases: many(administrationConfirmrelease),
	consumerPaymentfiles: many(consumerPaymentfile),
	consumerBankstatementlines: many(consumerBankstatementline),
}));

const administrationUserRelations = relations(administrationUser, ({many}) => ({
	consumerOrderauditevents: many(consumerOrderauditevent),
	administrationUserGroups: many(administrationUserGroups),
	administrationUserUserPermissions: many(administrationUserUserPermissions),
	authtokenTokens: many(authtokenToken),
	deliveryLedgerSettings: many(deliveryLedgerSettings),
	administrationDeliveryledgersettingsaudits: many(administrationDeliveryledgersettingsaudit),
	consumerAuditlogs: many(consumerAuditlog),
	consumerBankstatementcolumnmappings: many(consumerBankstatementcolumnmapping),
	administrationDailyreportapprovals: many(administrationDailyreportapproval),
	consumerOrderpaymentrecords: many(consumerOrderpaymentrecord),
	administrationStaffdailysalesreports: many(administrationStaffdailysalesreport),
	consumerPfimovements: many(consumerPfimovement),
	administrationUserLocations: many(administrationUserLocations),
	administrationUserPfis: many(administrationUserPfis),
	administrationRecords_submittedById: many(administrationRecord, {
		relationName: "administrationRecord_submittedById_administrationUser_id"
	}),
	administrationRecords_reviewedById: many(administrationRecord, {
		relationName: "administrationRecord_reviewedById_administrationUser_id"
	}),
	consumerOverpaymenttransferrequests_requestedById: many(consumerOverpaymenttransferrequest, {
		relationName: "consumerOverpaymenttransferrequest_requestedById_administrationUser_id"
	}),
	consumerOverpaymenttransferrequests_reviewedById: many(consumerOverpaymenttransferrequest, {
		relationName: "consumerOverpaymenttransferrequest_reviewedById_administrationUser_id"
	}),
	consumerLpgstockentries: many(consumerLpgstockentry),
	consumerLpgsales: many(consumerLpgsale),
	consumerOrders_paymentConfirmedById: many(consumerOrder, {
		relationName: "consumerOrder_paymentConfirmedById_administrationUser_id"
	}),
	consumerOrders_releasedById: many(consumerOrder, {
		relationName: "consumerOrder_releasedById_administrationUser_id"
	}),
	consumerOrders_securityExitedById: many(consumerOrder, {
		relationName: "consumerOrder_securityExitedById_administrationUser_id"
	}),
	consumerOrders_ticketGeneratedById: many(consumerOrder, {
		relationName: "consumerOrder_ticketGeneratedById_administrationUser_id"
	}),
	consumerOrders_commissionPaidById: many(consumerOrder, {
		relationName: "consumerOrder_commissionPaidById_administrationUser_id"
	}),
	consumerOrders_securityEnteredById: many(consumerOrder, {
		relationName: "consumerOrder_securityEnteredById_administrationUser_id"
	}),
	consumerTrucktickets_exitedById: many(consumerTruckticket, {
		relationName: "consumerTruckticket_exitedById_administrationUser_id"
	}),
	consumerTrucktickets_enteredById: many(consumerTruckticket, {
		relationName: "consumerTruckticket_enteredById_administrationUser_id"
	}),
	consumerBankstatements: many(consumerBankstatement),
	consumerBankstatementlines: many(consumerBankstatementline),
	consumerLocationcommissionrates: many(consumerLocationcommissionrate),
	administrationUserLpgPlants: many(administrationUserLpgPlants),
	administrationUserFillingStations: many(administrationUserFillingStations),
	administrationUsertokens: many(administrationUsertoken),
	consumerPfis_createdById: many(consumerPfi, {
		relationName: "consumerPfi_createdById_administrationUser_id"
	}),
	consumerPfis_financePersonId: many(consumerPfi, {
		relationName: "consumerPfi_financePersonId_administrationUser_id"
	}),
	consumerPfis_marketingPersonId: many(consumerPfi, {
		relationName: "consumerPfi_marketingPersonId_administrationUser_id"
	}),
	consumerPfis_auditOfficerId: many(consumerPfi, {
		relationName: "consumerPfi_auditOfficerId_administrationUser_id"
	}),
	consumerPfis_productOfficerId: many(consumerPfi, {
		relationName: "consumerPfi_productOfficerId_administrationUser_id"
	}),
	consumerPfis_itComplianceOfficerId: many(consumerPfi, {
		relationName: "consumerPfi_itComplianceOfficerId_administrationUser_id"
	}),
	consumerPfis_securityExitOfficerId: many(consumerPfi, {
		relationName: "consumerPfi_securityExitOfficerId_administrationUser_id"
	}),
	consumerPfis_commissionOfficerId: many(consumerPfi, {
		relationName: "consumerPfi_commissionOfficerId_administrationUser_id"
	}),
	consumerPfis_salesManagerId: many(consumerPfi, {
		relationName: "consumerPfi_salesManagerId_administrationUser_id"
	}),
	consumerPfiexpenses_addedById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_addedById_administrationUser_id"
	}),
	consumerPfiexpenses_editedById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_editedById_administrationUser_id"
	}),
	consumerPfiexpenses_reviewedById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_reviewedById_administrationUser_id"
	}),
	consumerPfiexpenses_adminApprovedById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_adminApprovedById_administrationUser_id"
	}),
	consumerPfiexpenses_auditApprovedById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_auditApprovedById_administrationUser_id"
	}),
	consumerPfiexpenses_paidById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_paidById_administrationUser_id"
	}),
	consumerPfiexpenses_verifiedById: many(consumerPfiexpense, {
		relationName: "consumerPfiexpense_verifiedById_administrationUser_id"
	}),
	consumerPfiexpenseaudits: many(consumerPfiexpenseaudit),
	consumerPfiexpenseattachments: many(consumerPfiexpenseattachment),
}));

const consumerTruckallocationRelations = relations(consumerTruckallocation, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerTruckallocation.orderId],
		references: [consumerOrder.id]
	}),
	consumerOrderproduct: one(consumerOrderproduct, {
		fields: [consumerTruckallocation.orderProductId],
		references: [consumerOrderproduct.id]
	}),
}));

const consumerOrderproductRelations = relations(consumerOrderproduct, ({one, many}) => ({
	consumerTruckallocations: many(consumerTruckallocation),
	consumerProduct: one(consumerProduct, {
		fields: [consumerOrderproduct.productId],
		references: [consumerProduct.id]
	}),
	consumerOrder: one(consumerOrder, {
		fields: [consumerOrderproduct.orderId],
		references: [consumerOrder.id]
	}),
}));

const administrationOfflinesalesRelations = relations(administrationOfflinesales, ({one, many}) => ({
	consumerState: one(consumerStates, {
		fields: [administrationOfflinesales.stateId],
		references: [consumerStates.id]
	}),
	administrationOfflinesalesTrucks: many(administrationOfflinesalesTrucks),
	administrationOfflinesalesproducts: many(administrationOfflinesalesproduct),
}));

const consumerStatesRelations = relations(consumerStates, ({many}) => ({
	administrationOfflinesales: many(administrationOfflinesales),
	consumerProductprices: many(consumerProductprice),
	consumerDeliveryorders: many(consumerDeliveryorders),
	consumerBankaccts: many(consumerBankacct),
	consumerPickuporders: many(consumerPickuporders),
	consumerAgents: many(consumerAgent),
	administrationUserLocations: many(administrationUserLocations),
	consumerOrders: many(consumerOrder),
	consumerPfiAllowedLocations: many(consumerPfiAllowedLocations),
	consumerLocationcommissionrates: many(consumerLocationcommissionrate),
	consumerLpgplants: many(consumerLpgplant),
	consumerPfis: many(consumerPfi),
}));

const administrationOfflinesalesTrucksRelations = relations(administrationOfflinesalesTrucks, ({one}) => ({
	administrationOfflinesale: one(administrationOfflinesales, {
		fields: [administrationOfflinesalesTrucks.offlinesalesId],
		references: [administrationOfflinesales.id]
	}),
	consumerTruck: one(consumerTruck, {
		fields: [administrationOfflinesalesTrucks.truckId],
		references: [consumerTruck.id]
	}),
}));

const consumerTruckRelations = relations(consumerTruck, ({many}) => ({
	administrationOfflinesalesTrucks: many(administrationOfflinesalesTrucks),
}));

const administrationUserGroupsRelations = relations(administrationUserGroups, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationUserGroups.userId],
		references: [administrationUser.id]
	}),
	authGroup: one(authGroup, {
		fields: [administrationUserGroups.groupId],
		references: [authGroup.id]
	}),
}));

const authGroupRelations = relations(authGroup, ({many}) => ({
	administrationUserGroups: many(administrationUserGroups),
	authGroupPermissions: many(authGroupPermissions),
	authUserGroups: many(authUserGroups),
}));

const administrationUserUserPermissionsRelations = relations(administrationUserUserPermissions, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationUserUserPermissions.userId],
		references: [administrationUser.id]
	}),
	authPermission: one(authPermission, {
		fields: [administrationUserUserPermissions.permissionId],
		references: [authPermission.id]
	}),
}));

const authPermissionRelations = relations(authPermission, ({one, many}) => ({
	administrationUserUserPermissions: many(administrationUserUserPermissions),
	djangoContentType: one(djangoContentType, {
		fields: [authPermission.contentTypeId],
		references: [djangoContentType.id]
	}),
	authGroupPermissions: many(authGroupPermissions),
	authUserUserPermissions: many(authUserUserPermissions),
}));

const administrationOfflinesalesproductRelations = relations(administrationOfflinesalesproduct, ({one}) => ({
	administrationOfflinesale: one(administrationOfflinesales, {
		fields: [administrationOfflinesalesproduct.offlineId],
		references: [administrationOfflinesales.id]
	}),
	consumerProduct: one(consumerProduct, {
		fields: [administrationOfflinesalesproduct.productId],
		references: [consumerProduct.id]
	}),
}));

const consumerProductRelations = relations(consumerProduct, ({many}) => ({
	administrationOfflinesalesproducts: many(administrationOfflinesalesproduct),
	consumerProductprices: many(consumerProductprice),
	consumerOrderproducts: many(consumerOrderproduct),
	consumerPfis: many(consumerPfi),
}));

const authtokenTokenRelations = relations(authtokenToken, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [authtokenToken.userId],
		references: [administrationUser.id]
	}),
}));

const deliveryLedgerSettingsRelations = relations(deliveryLedgerSettings, ({one, many}) => ({
	administrationUser: one(administrationUser, {
		fields: [deliveryLedgerSettings.updatedById],
		references: [administrationUser.id]
	}),
	administrationDeliveryledgersettingsaudits: many(administrationDeliveryledgersettingsaudit),
}));

const administrationDeliveryledgersettingsauditRelations = relations(administrationDeliveryledgersettingsaudit, ({one}) => ({
	deliveryLedgerSetting: one(deliveryLedgerSettings, {
		fields: [administrationDeliveryledgersettingsaudit.settingsObjId],
		references: [deliveryLedgerSettings.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [administrationDeliveryledgersettingsaudit.updatedById],
		references: [administrationUser.id]
	}),
}));

const consumerProductpriceRelations = relations(consumerProductprice, ({one}) => ({
	consumerProduct: one(consumerProduct, {
		fields: [consumerProductprice.productId],
		references: [consumerProduct.id]
	}),
	consumerState: one(consumerStates, {
		fields: [consumerProductprice.stateId],
		references: [consumerStates.id]
	}),
}));

const administrationDeliveryinventoryTrucksRelations = relations(administrationDeliveryinventoryTrucks, ({one}) => ({
	administrationDeliveryinventory: one(administrationDeliveryinventory, {
		fields: [administrationDeliveryinventoryTrucks.deliveryinventoryId],
		references: [administrationDeliveryinventory.id]
	}),
	consumerFleettruck: one(consumerFleettruck, {
		fields: [administrationDeliveryinventoryTrucks.fleettruckId],
		references: [consumerFleettruck.id]
	}),
}));

const administrationDeliveryinventoryRelations = relations(administrationDeliveryinventory, ({one, many}) => ({
	administrationDeliveryinventoryTrucks: many(administrationDeliveryinventoryTrucks),
	administrationDeliverycustomer: one(administrationDeliverycustomer, {
		fields: [administrationDeliveryinventory.customerId],
		references: [administrationDeliverycustomer.id]
	}),
	consumerFleettruck: one(consumerFleettruck, {
		fields: [administrationDeliveryinventory.truckId],
		references: [consumerFleettruck.id]
	}),
	consumerPfi: one(consumerPfi, {
		fields: [administrationDeliveryinventory.pfiId],
		references: [consumerPfi.id]
	}),
	administrationConfirmreleases: many(administrationConfirmrelease),
}));

const consumerFleettruckRelations = relations(consumerFleettruck, ({many}) => ({
	administrationDeliveryinventoryTrucks: many(administrationDeliveryinventoryTrucks),
	consumerFleetledgerentries: many(consumerFleetledgerentry),
	administrationDeliveryinventories: many(administrationDeliveryinventory),
}));

const consumerAuditlogRelations = relations(consumerAuditlog, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [consumerAuditlog.actorId],
		references: [administrationUser.id]
	}),
	consumerOrder: one(consumerOrder, {
		fields: [consumerAuditlog.orderId],
		references: [consumerOrder.id]
	}),
}));

const djangoContentTypeRelations = relations(djangoContentType, ({many}) => ({
	authPermissions: many(authPermission),
	djangoAdminLogs: many(djangoAdminLog),
}));

const authGroupPermissionsRelations = relations(authGroupPermissions, ({one}) => ({
	authPermission: one(authPermission, {
		fields: [authGroupPermissions.permissionId],
		references: [authPermission.id]
	}),
	authGroup: one(authGroup, {
		fields: [authGroupPermissions.groupId],
		references: [authGroup.id]
	}),
}));

const authUserGroupsRelations = relations(authUserGroups, ({one}) => ({
	authGroup: one(authGroup, {
		fields: [authUserGroups.groupId],
		references: [authGroup.id]
	}),
	authUser: one(authUser, {
		fields: [authUserGroups.userId],
		references: [authUser.id]
	}),
}));

const authUserRelations = relations(authUser, ({many}) => ({
	authUserGroups: many(authUserGroups),
	authUserUserPermissions: many(authUserUserPermissions),
	djangoAdminLogs: many(djangoAdminLog),
}));

const authUserUserPermissionsRelations = relations(authUserUserPermissions, ({one}) => ({
	authPermission: one(authPermission, {
		fields: [authUserUserPermissions.permissionId],
		references: [authPermission.id]
	}),
	authUser: one(authUser, {
		fields: [authUserUserPermissions.userId],
		references: [authUser.id]
	}),
}));

const consumerDeliveryordersRelations = relations(consumerDeliveryorders, ({one}) => ({
	consumerState: one(consumerStates, {
		fields: [consumerDeliveryorders.deliveryStateId],
		references: [consumerStates.id]
	}),
	consumerOrder: one(consumerOrder, {
		fields: [consumerDeliveryorders.orderId],
		references: [consumerOrder.id]
	}),
}));

const consumerBankacctRelations = relations(consumerBankacct, ({one, many}) => ({
	consumerState: one(consumerStates, {
		fields: [consumerBankacct.locationId],
		references: [consumerStates.id]
	}),
	consumerPfi: one(consumerPfi, {
		fields: [consumerBankacct.pfiId],
		references: [consumerPfi.id]
	}),
	consumerBankstatementcolumnmappings: many(consumerBankstatementcolumnmapping),
	consumerOrderpaymentinfos: many(consumerOrderpaymentinfo),
	consumerOrderpaymentrecords: many(consumerOrderpaymentrecord),
	consumerBankstatements: many(consumerBankstatement),
	consumerBankstatementlines: many(consumerBankstatementline),
}));

const consumerPfiRelations = relations(consumerPfi, ({one, many}) => ({
	consumerBankaccts: many(consumerBankacct),
	consumerPfimovements: many(consumerPfimovement),
	administrationUserPfis: many(administrationUserPfis),
	administrationDeliveryinventories: many(administrationDeliveryinventory),
	consumerOrders: many(consumerOrder),
	consumerPfiAllowedLocations: many(consumerPfiAllowedLocations),
	administrationUser_createdById: one(administrationUser, {
		fields: [consumerPfi.createdById],
		references: [administrationUser.id],
		relationName: "consumerPfi_createdById_administrationUser_id"
	}),
	consumerState: one(consumerStates, {
		fields: [consumerPfi.locationId],
		references: [consumerStates.id]
	}),
	consumerProduct: one(consumerProduct, {
		fields: [consumerPfi.productId],
		references: [consumerProduct.id]
	}),
	administrationUser_financePersonId: one(administrationUser, {
		fields: [consumerPfi.financePersonId],
		references: [administrationUser.id],
		relationName: "consumerPfi_financePersonId_administrationUser_id"
	}),
	administrationUser_marketingPersonId: one(administrationUser, {
		fields: [consumerPfi.marketingPersonId],
		references: [administrationUser.id],
		relationName: "consumerPfi_marketingPersonId_administrationUser_id"
	}),
	administrationUser_auditOfficerId: one(administrationUser, {
		fields: [consumerPfi.auditOfficerId],
		references: [administrationUser.id],
		relationName: "consumerPfi_auditOfficerId_administrationUser_id"
	}),
	administrationUser_productOfficerId: one(administrationUser, {
		fields: [consumerPfi.productOfficerId],
		references: [administrationUser.id],
		relationName: "consumerPfi_productOfficerId_administrationUser_id"
	}),
	administrationUser_itComplianceOfficerId: one(administrationUser, {
		fields: [consumerPfi.itComplianceOfficerId],
		references: [administrationUser.id],
		relationName: "consumerPfi_itComplianceOfficerId_administrationUser_id"
	}),
	administrationUser_securityExitOfficerId: one(administrationUser, {
		fields: [consumerPfi.securityExitOfficerId],
		references: [administrationUser.id],
		relationName: "consumerPfi_securityExitOfficerId_administrationUser_id"
	}),
	administrationUser_commissionOfficerId: one(administrationUser, {
		fields: [consumerPfi.commissionOfficerId],
		references: [administrationUser.id],
		relationName: "consumerPfi_commissionOfficerId_administrationUser_id"
	}),
	administrationUser_salesManagerId: one(administrationUser, {
		fields: [consumerPfi.salesManagerId],
		references: [administrationUser.id],
		relationName: "consumerPfi_salesManagerId_administrationUser_id"
	}),
	consumerPfiexpenses: many(consumerPfiexpense),
	consumerExpensecategories: many(consumerExpensecategory),
}));

const consumerPickuptruckRelations = relations(consumerPickuptruck, ({one}) => ({
	consumerPickuporder: one(consumerPickuporders, {
		fields: [consumerPickuptruck.pickupOrderId],
		references: [consumerPickuporders.id]
	}),
}));

const consumerPickupordersRelations = relations(consumerPickuporders, ({one, many}) => ({
	consumerPickuptrucks: many(consumerPickuptruck),
	consumerOrder: one(consumerOrder, {
		fields: [consumerPickuporders.orderId],
		references: [consumerOrder.id]
	}),
	consumerState: one(consumerStates, {
		fields: [consumerPickuporders.stateId],
		references: [consumerStates.id]
	}),
}));

const consumerBankstatementcolumnmappingRelations = relations(consumerBankstatementcolumnmapping, ({one}) => ({
	consumerBankacct: one(consumerBankacct, {
		fields: [consumerBankstatementcolumnmapping.bankAccountId],
		references: [consumerBankacct.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerBankstatementcolumnmapping.createdById],
		references: [administrationUser.id]
	}),
}));

const consumerOrderpaymentinfoRelations = relations(consumerOrderpaymentinfo, ({one}) => ({
	consumerBankacct: one(consumerBankacct, {
		fields: [consumerOrderpaymentinfo.bankAccountId],
		references: [consumerBankacct.id]
	}),
	consumerOrder: one(consumerOrder, {
		fields: [consumerOrderpaymentinfo.orderId],
		references: [consumerOrder.id]
	}),
	consumerPaymentchannel: one(consumerPaymentchannels, {
		fields: [consumerOrderpaymentinfo.paymentChannelId],
		references: [consumerPaymentchannels.id]
	}),
}));

const consumerPaymentchannelsRelations = relations(consumerPaymentchannels, ({many}) => ({
	consumerOrderpaymentinfos: many(consumerOrderpaymentinfo),
}));

const administrationDailyreportapprovalRelations = relations(administrationDailyreportapproval, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationDailyreportapproval.approvedById],
		references: [administrationUser.id]
	}),
}));

const consumerOrderpaymentrecordRelations = relations(consumerOrderpaymentrecord, ({one, many}) => ({
	consumerBankacct: one(consumerBankacct, {
		fields: [consumerOrderpaymentrecord.bankAccountId],
		references: [consumerBankacct.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerOrderpaymentrecord.createdById],
		references: [administrationUser.id]
	}),
	consumerOrder: one(consumerOrder, {
		fields: [consumerOrderpaymentrecord.orderId],
		references: [consumerOrder.id]
	}),
	consumerBankstatementlines: many(consumerBankstatementline),
}));

const djangoAdminLogRelations = relations(djangoAdminLog, ({one}) => ({
	djangoContentType: one(djangoContentType, {
		fields: [djangoAdminLog.contentTypeId],
		references: [djangoContentType.id]
	}),
	authUser: one(authUser, {
		fields: [djangoAdminLog.userId],
		references: [authUser.id]
	}),
}));

const administrationStaffdailysalesreportRelations = relations(administrationStaffdailysalesreport, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationStaffdailysalesreport.submittedById],
		references: [administrationUser.id]
	}),
}));

const consumerAgentRelations = relations(consumerAgent, ({one, many}) => ({
	consumerState: one(consumerStates, {
		fields: [consumerAgent.locationId],
		references: [consumerStates.id]
	}),
	consumerOrders: many(consumerOrder),
}));

const consumerPfimovementRelations = relations(consumerPfimovement, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerPfimovement.orderId],
		references: [consumerOrder.id]
	}),
	consumerPfi: one(consumerPfi, {
		fields: [consumerPfimovement.pfiId],
		references: [consumerPfi.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerPfimovement.userId],
		references: [administrationUser.id]
	}),
}));

const consumerTruckbreakdownRelations = relations(consumerTruckbreakdown, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerTruckbreakdown.orderId],
		references: [consumerOrder.id]
	}),
}));

const consumerFleetledgerentryRelations = relations(consumerFleetledgerentry, ({one}) => ({
	consumerFleettruck: one(consumerFleettruck, {
		fields: [consumerFleetledgerentry.truckId],
		references: [consumerFleettruck.id]
	}),
}));

const administrationUserLocationsRelations = relations(administrationUserLocations, ({one}) => ({
	consumerState: one(consumerStates, {
		fields: [administrationUserLocations.statesId],
		references: [consumerStates.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [administrationUserLocations.userId],
		references: [administrationUser.id]
	}),
}));

const administrationUserPfisRelations = relations(administrationUserPfis, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationUserPfis.userId],
		references: [administrationUser.id]
	}),
	consumerPfi: one(consumerPfi, {
		fields: [administrationUserPfis.pfiId],
		references: [consumerPfi.id]
	}),
}));

const administrationRecordRelations = relations(administrationRecord, ({one}) => ({
	administrationUser_submittedById: one(administrationUser, {
		fields: [administrationRecord.submittedById],
		references: [administrationUser.id],
		relationName: "administrationRecord_submittedById_administrationUser_id"
	}),
	administrationUser_reviewedById: one(administrationUser, {
		fields: [administrationRecord.reviewedById],
		references: [administrationUser.id],
		relationName: "administrationRecord_reviewedById_administrationUser_id"
	}),
}));

const consumerOverpaymenttransferrequestRelations = relations(consumerOverpaymenttransferrequest, ({one}) => ({
	administrationUser_requestedById: one(administrationUser, {
		fields: [consumerOverpaymenttransferrequest.requestedById],
		references: [administrationUser.id],
		relationName: "consumerOverpaymenttransferrequest_requestedById_administrationUser_id"
	}),
	administrationUser_reviewedById: one(administrationUser, {
		fields: [consumerOverpaymenttransferrequest.reviewedById],
		references: [administrationUser.id],
		relationName: "consumerOverpaymenttransferrequest_reviewedById_administrationUser_id"
	}),
	consumerOrder_sourceOrderId: one(consumerOrder, {
		fields: [consumerOverpaymenttransferrequest.sourceOrderId],
		references: [consumerOrder.id],
		relationName: "consumerOverpaymenttransferrequest_sourceOrderId_consumerOrder_id"
	}),
	consumerOrder_targetOrderId: one(consumerOrder, {
		fields: [consumerOverpaymenttransferrequest.targetOrderId],
		references: [consumerOrder.id],
		relationName: "consumerOverpaymenttransferrequest_targetOrderId_consumerOrder_id"
	}),
}));

const administrationDeliverycustomerRelations = relations(administrationDeliverycustomer, ({many}) => ({
	administrationDeliveryinventories: many(administrationDeliveryinventory),
	administrationDeliverysales: many(administrationDeliverysale),
	administrationUserFillingStations: many(administrationUserFillingStations),
}));

const consumerLpgstockentryRelations = relations(consumerLpgstockentry, ({one}) => ({
	consumerLpgplant: one(consumerLpgplant, {
		fields: [consumerLpgstockentry.plantId],
		references: [consumerLpgplant.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerLpgstockentry.recordedById],
		references: [administrationUser.id]
	}),
}));

const consumerLpgplantRelations = relations(consumerLpgplant, ({one, many}) => ({
	consumerLpgstockentries: many(consumerLpgstockentry),
	consumerLpgsales: many(consumerLpgsale),
	consumerState: one(consumerStates, {
		fields: [consumerLpgplant.locationId],
		references: [consumerStates.id]
	}),
	administrationUserLpgPlants: many(administrationUserLpgPlants),
}));

const consumerPaymentsplitRelations = relations(consumerPaymentsplit, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerPaymentsplit.orderId],
		references: [consumerOrder.id]
	}),
}));

const consumerLpgsaleRelations = relations(consumerLpgsale, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [consumerLpgsale.cashierId],
		references: [administrationUser.id]
	}),
	consumerLpgplant: one(consumerLpgplant, {
		fields: [consumerLpgsale.plantId],
		references: [consumerLpgplant.id]
	}),
}));

const consumerCustomerRelations = relations(consumerCustomer, ({many}) => ({
	consumerOrders: many(consumerOrder),
}));

const consumerTruckticketRelations = relations(consumerTruckticket, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerTruckticket.orderId],
		references: [consumerOrder.id]
	}),
	administrationUser_exitedById: one(administrationUser, {
		fields: [consumerTruckticket.exitedById],
		references: [administrationUser.id],
		relationName: "consumerTruckticket_exitedById_administrationUser_id"
	}),
	administrationUser_enteredById: one(administrationUser, {
		fields: [consumerTruckticket.enteredById],
		references: [administrationUser.id],
		relationName: "consumerTruckticket_enteredById_administrationUser_id"
	}),
}));

const administrationDeliverysaleRelations = relations(administrationDeliverysale, ({one}) => ({
	administrationDeliverycustomer: one(administrationDeliverycustomer, {
		fields: [administrationDeliverysale.customerId],
		references: [administrationDeliverycustomer.id]
	}),
}));

const consumerPfiAllowedLocationsRelations = relations(consumerPfiAllowedLocations, ({one}) => ({
	consumerPfi: one(consumerPfi, {
		fields: [consumerPfiAllowedLocations.pfiId],
		references: [consumerPfi.id]
	}),
	consumerState: one(consumerStates, {
		fields: [consumerPfiAllowedLocations.statesId],
		references: [consumerStates.id]
	}),
}));

const administrationConfirmreleaseRelations = relations(administrationConfirmrelease, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [administrationConfirmrelease.orderId],
		references: [consumerOrder.id]
	}),
	administrationDeliveryinventory: one(administrationDeliveryinventory, {
		fields: [administrationConfirmrelease.inventoryId],
		references: [administrationDeliveryinventory.id]
	}),
}));

const consumerPaymentfileRelations = relations(consumerPaymentfile, ({one}) => ({
	consumerOrder: one(consumerOrder, {
		fields: [consumerPaymentfile.orderId],
		references: [consumerOrder.id]
	}),
}));

const djangoCeleryBeatPeriodictaskRelations = relations(djangoCeleryBeatPeriodictask, ({one}) => ({
	djangoCeleryBeatCrontabschedule: one(djangoCeleryBeatCrontabschedule, {
		fields: [djangoCeleryBeatPeriodictask.crontabId],
		references: [djangoCeleryBeatCrontabschedule.id]
	}),
	djangoCeleryBeatIntervalschedule: one(djangoCeleryBeatIntervalschedule, {
		fields: [djangoCeleryBeatPeriodictask.intervalId],
		references: [djangoCeleryBeatIntervalschedule.id]
	}),
	djangoCeleryBeatSolarschedule: one(djangoCeleryBeatSolarschedule, {
		fields: [djangoCeleryBeatPeriodictask.solarId],
		references: [djangoCeleryBeatSolarschedule.id]
	}),
	djangoCeleryBeatClockedschedule: one(djangoCeleryBeatClockedschedule, {
		fields: [djangoCeleryBeatPeriodictask.clockedId],
		references: [djangoCeleryBeatClockedschedule.id]
	}),
}));

const djangoCeleryBeatCrontabscheduleRelations = relations(djangoCeleryBeatCrontabschedule, ({many}) => ({
	djangoCeleryBeatPeriodictasks: many(djangoCeleryBeatPeriodictask),
}));

const djangoCeleryBeatIntervalscheduleRelations = relations(djangoCeleryBeatIntervalschedule, ({many}) => ({
	djangoCeleryBeatPeriodictasks: many(djangoCeleryBeatPeriodictask),
}));

const djangoCeleryBeatSolarscheduleRelations = relations(djangoCeleryBeatSolarschedule, ({many}) => ({
	djangoCeleryBeatPeriodictasks: many(djangoCeleryBeatPeriodictask),
}));

const djangoCeleryBeatClockedscheduleRelations = relations(djangoCeleryBeatClockedschedule, ({many}) => ({
	djangoCeleryBeatPeriodictasks: many(djangoCeleryBeatPeriodictask),
}));

const consumerBankstatementRelations = relations(consumerBankstatement, ({one, many}) => ({
	consumerBankacct: one(consumerBankacct, {
		fields: [consumerBankstatement.bankAccountId],
		references: [consumerBankacct.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerBankstatement.uploadedById],
		references: [administrationUser.id]
	}),
	consumerBankstatementlines: many(consumerBankstatementline),
}));

const consumerBankstatementlineRelations = relations(consumerBankstatementline, ({one}) => ({
	consumerBankacct: one(consumerBankacct, {
		fields: [consumerBankstatementline.bankAccountId],
		references: [consumerBankacct.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerBankstatementline.matchedById],
		references: [administrationUser.id]
	}),
	consumerOrder: one(consumerOrder, {
		fields: [consumerBankstatementline.matchedOrderId],
		references: [consumerOrder.id]
	}),
	consumerOrderpaymentrecord: one(consumerOrderpaymentrecord, {
		fields: [consumerBankstatementline.matchedPaymentRecordId],
		references: [consumerOrderpaymentrecord.id]
	}),
	consumerBankstatement: one(consumerBankstatement, {
		fields: [consumerBankstatementline.statementId],
		references: [consumerBankstatement.id]
	}),
}));

const consumerLocationcommissionrateRelations = relations(consumerLocationcommissionrate, ({one}) => ({
	consumerState: one(consumerStates, {
		fields: [consumerLocationcommissionrate.locationId],
		references: [consumerStates.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerLocationcommissionrate.updatedById],
		references: [administrationUser.id]
	}),
}));

const administrationUserLpgPlantsRelations = relations(administrationUserLpgPlants, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationUserLpgPlants.userId],
		references: [administrationUser.id]
	}),
	consumerLpgplant: one(consumerLpgplant, {
		fields: [administrationUserLpgPlants.lpgplantId],
		references: [consumerLpgplant.id]
	}),
}));

const administrationUserFillingStationsRelations = relations(administrationUserFillingStations, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationUserFillingStations.userId],
		references: [administrationUser.id]
	}),
	administrationDeliverycustomer: one(administrationDeliverycustomer, {
		fields: [administrationUserFillingStations.deliverycustomerId],
		references: [administrationDeliverycustomer.id]
	}),
}));

const administrationUsertokenRelations = relations(administrationUsertoken, ({one}) => ({
	administrationUser: one(administrationUser, {
		fields: [administrationUsertoken.userId],
		references: [administrationUser.id]
	}),
}));

const consumerPfiexpenseRelations = relations(consumerPfiexpense, ({one, many}) => ({
	administrationUser_addedById: one(administrationUser, {
		fields: [consumerPfiexpense.addedById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_addedById_administrationUser_id"
	}),
	administrationUser_editedById: one(administrationUser, {
		fields: [consumerPfiexpense.editedById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_editedById_administrationUser_id"
	}),
	consumerExpensecategory: one(consumerExpensecategory, {
		fields: [consumerPfiexpense.categoryId],
		references: [consumerExpensecategory.id]
	}),
	consumerPfi: one(consumerPfi, {
		fields: [consumerPfiexpense.pfiId],
		references: [consumerPfi.id]
	}),
	administrationUser_reviewedById: one(administrationUser, {
		fields: [consumerPfiexpense.reviewedById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_reviewedById_administrationUser_id"
	}),
	administrationUser_adminApprovedById: one(administrationUser, {
		fields: [consumerPfiexpense.adminApprovedById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_adminApprovedById_administrationUser_id"
	}),
	administrationUser_auditApprovedById: one(administrationUser, {
		fields: [consumerPfiexpense.auditApprovedById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_auditApprovedById_administrationUser_id"
	}),
	administrationUser_paidById: one(administrationUser, {
		fields: [consumerPfiexpense.paidById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_paidById_administrationUser_id"
	}),
	administrationUser_verifiedById: one(administrationUser, {
		fields: [consumerPfiexpense.verifiedById],
		references: [administrationUser.id],
		relationName: "consumerPfiexpense_verifiedById_administrationUser_id"
	}),
	consumerPfiexpenseaudits: many(consumerPfiexpenseaudit),
	consumerPfiexpenseattachments: many(consumerPfiexpenseattachment),
}));

const consumerExpensecategoryRelations = relations(consumerExpensecategory, ({one, many}) => ({
	consumerPfiexpenses: many(consumerPfiexpense),
	consumerPfi: one(consumerPfi, {
		fields: [consumerExpensecategory.pfiId],
		references: [consumerPfi.id]
	}),
}));

const consumerPfiexpenseauditRelations = relations(consumerPfiexpenseaudit, ({one}) => ({
	consumerPfiexpense: one(consumerPfiexpense, {
		fields: [consumerPfiexpenseaudit.expenseId],
		references: [consumerPfiexpense.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerPfiexpenseaudit.performedById],
		references: [administrationUser.id]
	}),
}));

const consumerPfiexpenseattachmentRelations = relations(consumerPfiexpenseattachment, ({one}) => ({
	consumerPfiexpense: one(consumerPfiexpense, {
		fields: [consumerPfiexpenseattachment.expenseId],
		references: [consumerPfiexpense.id]
	}),
	administrationUser: one(administrationUser, {
		fields: [consumerPfiexpenseattachment.uploadedById],
		references: [administrationUser.id]
	}),
}));

module.exports = {
  consumerOrderauditeventRelations,
  consumerOrderRelations,
  administrationUserRelations,
  consumerTruckallocationRelations,
  consumerOrderproductRelations,
  administrationOfflinesalesRelations,
  consumerStatesRelations,
  administrationOfflinesalesTrucksRelations,
  consumerTruckRelations,
  administrationUserGroupsRelations,
  authGroupRelations,
  administrationUserUserPermissionsRelations,
  authPermissionRelations,
  administrationOfflinesalesproductRelations,
  consumerProductRelations,
  authtokenTokenRelations,
  deliveryLedgerSettingsRelations,
  administrationDeliveryledgersettingsauditRelations,
  consumerProductpriceRelations,
  administrationDeliveryinventoryTrucksRelations,
  administrationDeliveryinventoryRelations,
  consumerFleettruckRelations,
  consumerAuditlogRelations,
  djangoContentTypeRelations,
  authGroupPermissionsRelations,
  authUserGroupsRelations,
  authUserRelations,
  authUserUserPermissionsRelations,
  consumerDeliveryordersRelations,
  consumerBankacctRelations,
  consumerPfiRelations,
  consumerPickuptruckRelations,
  consumerPickupordersRelations,
  consumerBankstatementcolumnmappingRelations,
  consumerOrderpaymentinfoRelations,
  consumerPaymentchannelsRelations,
  administrationDailyreportapprovalRelations,
  consumerOrderpaymentrecordRelations,
  djangoAdminLogRelations,
  administrationStaffdailysalesreportRelations,
  consumerAgentRelations,
  consumerPfimovementRelations,
  consumerTruckbreakdownRelations,
  consumerFleetledgerentryRelations,
  administrationUserLocationsRelations,
  administrationUserPfisRelations,
  administrationRecordRelations,
  consumerOverpaymenttransferrequestRelations,
  administrationDeliverycustomerRelations,
  consumerLpgstockentryRelations,
  consumerLpgplantRelations,
  consumerPaymentsplitRelations,
  consumerLpgsaleRelations,
  consumerCustomerRelations,
  consumerTruckticketRelations,
  administrationDeliverysaleRelations,
  consumerPfiAllowedLocationsRelations,
  administrationConfirmreleaseRelations,
  consumerPaymentfileRelations,
  djangoCeleryBeatPeriodictaskRelations,
  djangoCeleryBeatCrontabscheduleRelations,
  djangoCeleryBeatIntervalscheduleRelations,
  djangoCeleryBeatSolarscheduleRelations,
  djangoCeleryBeatClockedscheduleRelations,
  consumerBankstatementRelations,
  consumerBankstatementlineRelations,
  consumerLocationcommissionrateRelations,
  administrationUserLpgPlantsRelations,
  administrationUserFillingStationsRelations,
  administrationUsertokenRelations,
  consumerPfiexpenseRelations,
  consumerExpensecategoryRelations,
  consumerPfiexpenseauditRelations,
  consumerPfiexpenseattachmentRelations,
};

/*------------------------------------------------------------------
Authors: Ikram El Hazdour & Michel LePage (IRD/CESBIO)
Contact: ikram.el_hazdour@ird.fr
v0: April 16th 2023: first lines with Random Forest
v1.3: July 07, 2023 : Function for creating input sat data, and monthly combination, random forest, metrics 70/30%, classifications from 2017 to 2023 
*/

var do_interpo=true; // if this variable is true, the times series will be interpolated with Savitsky-Golay.
var refArea = geometry2; // the area to work on
 /* ROI COORDINATES (geometry2): 
  [[-9.090860602921504,31.090140411254595],
   [-8.478372809952754,31.090140411254595],
   [-8.478372809952754,31.624889989205034],
   [-9.090860602921504,31.624889989205034],
   [-9.090860602921504,31.090140411254595]]]
   */
var MAX_CLOUD_PROBABILITY = 65;

// Load the shapefile (ground data)
var label ='Class2'
var shapefile = ee.FeatureCollection('projects/ee-ielhazdourced/assets/shapefilesCollection/dataset11072023_bassin2500')
    .filterMetadata(label, 'not_equals', null)
     .filterMetadata('id', 'not_equals', 203)
     .filterMetadata('id', 'not_equals', 204)
    //.filterMetadata('id', 'not_equals', 204);
    
var shapefile2021 = ee.FeatureCollection('projects/ee-ielhazdourced/assets/shapefilesCollection/dataset16072023_oneclasse')
    .filterMetadata(label, 'not_equals', null);  
var perimetre = ee.FeatureCollection('projects/ee-ielhazdourced/assets/shapefilesCollection/PERIMETRE_abainou');

var listYears = ["1999","2000","2001","2002","2003","2004","2005","2006","2007","2008","2009","2010","2011","2012","2013","2014","2015","2016","2023"]; //years to process with Landsat-8
    
Map.setOptions("HYBRID");


//*********************************************************************************
//=======================1. CLOUD AND SHADOW MASKING==============================
//*********************************************************************************

//FUNCTION FOR LANDSTA-5,8,9
//For interpo
print(ee.Number.parse("2023").add(-1).format("%d"));
function combinerL8(year) {
  var year_before=ee.Number.parse(year).add(-1).format("%d");
  var START_DATE = year_before.cat("-12-01");
  var END_DATE = year + "-11-01";
  
  //APPLY CLOUD MASK TO THE LANDSAT COLLECTION + MERGE L5-8-9
  //** Scale factors
function applyScaleFactors(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  //var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  return image.addBands(opticalBands, null, true);
}

// slope and intercept citation: Roy, D.P., Kovalskyy, V., Zhang, H.K., Vermote, E.F., Yan, L., Kumar, S.S, Egorov, A., 2016, Characterization of Landsat-7 to Landsat-8 reflective wavelength and normalized difference vegetation index continuity, Remote Sensing of Environment, 185, 57-70.(http://dx.doi.org/10.1016/j.rse.2015.12.024); Table 2 - reduced major axis (RMA) regression coefficients
// ****harmonize tm and etm+ to oli******
var tm2oli = function(tm) {
  var slopes = ee.Image.constant([0.9785, 0.9542, 0.9825, 1.0073, 1.0171, 0.9949]);
  var itcp = ee.Image.constant([-0.0095, -0.0016, -0.0022, -0.0021, -0.0030, 0.0029]);
   var y = tm.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'],['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
             //.resample('bicubic')
             //.multiply(slopes).add(itcp.multiply(10000))
             .set('system:time_start', tm.get('system:time_start'));
  return y;
};

var cloudMaskL457 = function(image) {
  var qa = image.select('pixel_qa');
  // If the cloud bit (5) is set and the cloud confidence (7) is high
  // or the cloud shadow bit is set (3), then it's a bad pixel.
  var cloud = qa.bitwiseAnd(1 << 5)
          .and(qa.bitwiseAnd(1 << 7))
          .or(qa.bitwiseAnd(1 << 3));
  // Remove edge pixels that don't occur in all bands
  var mask2 = image.mask().reduce(ee.Reducer.min());
  return image.updateMask(cloud.not()).updateMask(mask2)
      .copyProperties(image, ["system:time_start"]);
};

function maskL8sr(image) {
    // Bit 0 - Fill
    // Bit 1 - Dilated Cloud
    // Bit 2 - Cirrus
    // Bit 3 - Cloud
    // Bit 4 - Cloud Shadow
    // Bit 5 - Snow
    var qaMask = image.select(['QA_PIXEL']).bitwiseAnd(parseInt('111111', 2)).eq(0)
    var saturationMask = image.select("QA_RADSAT").eq(0)

    // Replace the original bands with the scaled ones and apply the masks.
    return image.updateMask(qaMask).updateMask(saturationMask)
}

function maskL7(img){
  var qa = img.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(8).eq(0)  // Shadow
                .and(qa.bitwiseAnd(4).eq(0))  // Water
                .and(qa.bitwiseAnd(16).eq(0))  // Snow
                .and(qa.bitwiseAnd(32).eq(0))  // Clouds
  var mask2 = img.select("QA_RADSAT").eq(0)                

  // This gets rid of irritating fixed-pattern noise at the edge of the images.
  var mask3 = img.select('SR_B.*').gt(0).reduce('min');
  
  // this does not mask all bad pixels
  // var maskObersaturation = image.select('radsat_qa').eq(0)

 // var maskObersaturation = img.select(['SR_B1', 'SR_B3', 'SR_B4']).reduce(ee.Reducer.max()).lt(8000)
   // .focal_min(90, 'square', 'meters')
               
  return img.updateMask(mask).updateMask(mask2).updateMask(mask3)
  //return img.updateMask(mask).updateMask(mask2).updateMask(mask3).updateMask(maskObersaturation)
}

   /* Landsat 5,8,9 image collections==============================================
  ===========================================================================*/

   var l5sr = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2")
    .filterBounds(refArea)
    .filterDate(START_DATE, END_DATE )
    .map(maskL7)
    .map(tm2oli)
  //  .filter(ee.Filter.lt('CLOUD_COVER', 20))
    .map(applyScaleFactors);  

   var l7sr = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2")
    .filterBounds(refArea)
    .filterDate(START_DATE, END_DATE )
    .map(maskL7)
    .map(tm2oli)
  //  .filter(ee.Filter.lt('CLOUD_COVER', 20))
    .map(applyScaleFactors);  

  var l8sr = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(refArea)
    .filterDate(START_DATE, END_DATE )
   // .filter(ee.Filter.lt('CLOUD_COVER', 20))
    .map(applyScaleFactors)
    .map(maskL8sr);
    
  var l9sr = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
    .filterBounds(refArea)
    .filterDate(START_DATE, END_DATE )
  //  .filter(ee.Filter.lt('CLOUD_COVER', 20))
    .map(applyScaleFactors)
    .map(maskL8sr);
    
   // Add NDVI and NDWI bands to the LANDSAT image collections
  //---L8 & L9-----------
  var addIndices = function(image) {
    var ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
    var evi2 = image.expression(
      '(2.5 * (NIR - Red)) / (NIR + 2.4 * Red + 1)',
      {
        'NIR': image.select('SR_B5'),
        'Red': image.select('SR_B4')
      }
    ).rename('EVI2');
    var ndwi = image.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI');
   
    return image.addBands([ndvi, evi2, ndwi]);
  };
 //----L5-------- 
/* var addIndicesL5 = function(image) {
    var ndvi = image.normalizedDifference(['SR_B4', 'SR_B3']).rename('NDVI');
    var ndwi = image.normalizedDifference(['SR_B2', 'SR_B4']).rename('NDWI');
  
  return image.addBands(ndvi);
 }*/ 
  
  /* Apply index calculation to the image collections===========================
  ===========================================================================*/
  l5sr = l5sr.map(addIndices);
  l7sr = l7sr.map(addIndices);
  l8sr = l8sr.map(addIndices);
  l9sr = l9sr.map(addIndices);
  
  var bandsLandsat = [ 'SR_B2','SR_B3','SR_B4','SR_B5','SR_B6', 'SR_B7','NDVI','EVI2','NDWI']
  //var bandsLandsat = [ 'SR_B5', 'SR_B7','NDVI','NDWI']
  var bandsLandsat = [ 'SR_B2','SR_B3','SR_B4','SR_B5','SR_B6', 'SR_B7','NDVI','EVI2','NDWI']

  l5sr =l5sr.select(bandsLandsat);
  l7sr =l7sr.select(bandsLandsat);
  l8sr =l8sr.select(bandsLandsat);
  l9sr =l9sr.select(bandsLandsat);
 //=========merge=========
 var l5l8l9 = l5sr.merge(l7sr).merge(l8sr).merge(l9sr);
 //var l5l8l9 = l5sr.merge(l8sr);
 
// Clip each image in the collection to the refArea
l5l8l9 = l5l8l9.map(function(image) {
  return image.clip(refArea);
});

  print("l5l8l9=====",l5l8l9);

//*********************************************************************************
//=========================== CLOUD COVER PERCENTAGE ==============================
//*********************************************************************************
  
  // Function to calculate cloud metrics for Landsat
function calculateCloudMetrics(img) {
  // Get QA band (different for different Landsat versions)
  var qa = img.select('QA_PIXEL');
  var cloudMask;
  
  // Landsat 4-7 (TM/ETM+)
  if (img.get('SPACECRAFT_ID')) {
    var spacecraft = ee.String(img.get('SPACECRAFT_ID'));
    if (spacecraft.match('LANDSAT_5|LANDSAT_7').length()) {
      cloudMask = qa.bitwiseAnd(1 << 5).or(qa.bitwiseAnd(1 << 3)); // Cloud or cloud shadow
    }
  }
  // Landsat 8/9 (OLI)
  else {
    cloudMask = qa.bitwiseAnd(1 << 3).or(qa.bitwiseAnd(1 << 4)); // Cloud or cloud shadow
  }

  // Calculate cloud percentage over ROI
  var stats = cloudMask.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: refArea,
    scale: 30, 
    bestEffort: true,
    maxPixels: 1e9
  });
  
  var cloudPct = ee.Number(stats.get('QA_PIXEL')).multiply(100);
  var isCloudFree = cloudPct.lt(10); // <10% = cloud-free
  
  // Apply cloud mask to the image
  var maskedImg = img.updateMask(cloudMask.not());
  
  return maskedImg.set({
    'cloud_percentage': cloudPct,
    'is_cloud_free': isCloudFree,
    'date': img.date().format('YYYY-MM-dd')
  });
}
//*********************************************************************************
//==========================  CLOUD STATS FUNCTION ================================
//*********************************************************************************
function computeLandsatCloudStats(year) {
  var year_before = ee.Number.parse(year).add(-1).format("%d");
  var START_DATE = year_before.cat("-12-01");
  var END_DATE = year + "-11-01";
  
  var l5 = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2")
    .filterBounds(refArea).filterDate(START_DATE, END_DATE);
  var l7 = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2")
    .filterBounds(refArea).filterDate(START_DATE, END_DATE);
  var l8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(refArea).filterDate(START_DATE, END_DATE);
  var l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
    .filterBounds(refArea).filterDate(START_DATE, END_DATE);
  
  var merged = l5.merge(l7).merge(l8).merge(l9);

  var withMetrics = merged.map(calculateCloudMetrics);
  
  // Count cloud-free images
  var cloudFree = withMetrics.filter(ee.Filter.eq('is_cloud_free', 1));
  
  var stats = {
    total_images: withMetrics.size(),
    cloud_free_images: cloudFree.size(),
    cloud_free_ratio: ee.Number(cloudFree.size()).divide(withMetrics.size()).multiply(100),
    mean_cloud_pct: withMetrics.aggregate_mean('cloud_percentage'),
    cloud_percentages: withMetrics.aggregate_array('cloud_percentage'),
    dates: withMetrics.aggregate_array('date')
  };
  
  return stats;
}

var stats = computeLandsatCloudStats("2000");

print('Total images:', stats.total_images);
print('Cloud-free images:', stats.cloud_free_images);
print('Cloud-free ratio (%):', stats.cloud_free_ratio);
print('Mean cloud coverage (%):', stats.mean_cloud_pct);

//*********************************************************************************
//===============================2. INTERPOLATION==================================
//*********************************************************************************
  if (do_interpo === true) {
   
    var oeel=require('users/OEEL/lib:loadAll');
    
    var l5l8l9 = oeel.ImageCollection.SavatskyGolayFilter(l5l8l9,
            ee.Filter.maxDifference(1000*3600*24*80, 'system:time_start', null, 'system:time_start'),
            function(infromedImage,estimationImage){
              return ee.Image.constant(ee.Number(infromedImage.get('system:time_start'))
                .subtract(ee.Number(estimationImage.get('system:time_start'))));},
            3); 
    
    l5l8l9 = l5l8l9.select(['d_0_.*','NDVI','NDWI']); 
    Map.addLayer(l5l8l9.select(['d_0_NDVI','NDVI']), { bands: ['d_0_NDVI','NDVI'], min: 0, max: 1 }, 'L8 NDVI sg '+year,false);
    print('L8 Savgol time series '+year, l5l8l9); 
    var bandsL8 = ['d_0_SR_B2','d_0_SR_B3','d_0_SR_B4','d_0_SR_B5','d_0_SR_B6','d_0_SR_B7', 'd_0_NDVI', 'd_0_EVI2', 'd_0_NDWI']; //Landsat 8
    var rgbL8 = ['d_0_SR_B5', 'd_0_SR_B4', 'd_0_SR_B2']; //Landsat 8
    } // fin de la fonction l'interpolation
  else
  {
    var bandsL8 = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6', 'SR_B7', 'NDVI', 'EVI2', 'NDWI'];
    var bandsL8 = ['d_0_SR_B2','d_0_SR_B3','d_0_SR_B4','d_0_SR_B5','d_0_SR_B6','d_0_SR_B7', 'd_0_NDVI', 'd_0_EVI2', 'd_0_NDWI'];//Landsat 8
    var rgbL8 = ['SR_B5', 'SR_B4', 'SR_B2']; //Landsat 8

  }
  // display mean composites (winter & summer)

 /* var mean_janL8 =l5l8l9.select(rgbL8).filterDate(year+'-01-01', year+'-02-01').mean();// Landsat 8
  Map.addLayer(mean_janL8, { bands: rgbL8, min: 0, max: 0.5 }, 'L8 Jan '+year,false); //Landsat 8
  var mean_juneL8 =l5l8l9.select(rgbL8).filterDate(year+'-06-01', year+'-07-01').mean();//Landsat 8
  Map.addLayer(mean_juneL8, { bands: rgbL8, min: 0, max: 0.5 }, 'L8 June '+year,false);//Landsat 8
*/    
    
//*********************************************************************************
//===============================3. FEATURE STACK =================================
//*********************************************************************************
 var combinedL8 = ee.Image.cat([
    l5l8l9.filterDate(year+"-01-01", year+"-02-15").select(bandsL8).reduce('median', 8),
    l5l8l9.filterDate(year+"-02-15", year+"-04-01").select(bandsL8).reduce('median', 8),
    l5l8l9.filterDate(year+"-04-01", year+"-05-15").select(bandsL8).reduce('median', 8),
    l5l8l9.filterDate(year+"-05-15", year+"-07-01").select(bandsL8).reduce('median', 8),
    l5l8l9.filterDate(year+"-07-01", year+"-08-15").select(bandsL8).reduce('median', 8),
    l5l8l9.filterDate(year+"-08-15", year+"-10-01").select(bandsL8).reduce('median', 8),
    ]).toFloat();
  
  print("====CombinedL8 "+ year, combinedL8);
  return(combinedL8)
  } // fin de la fonction combinerL8()  
  
//*********************************************END FUNCTIONS FOR LANDSAT*************************************************
 

//*********************************************************************************
//=============================== 4. SAMPLING =====================================
//*********************************************************************************

//================CLASSIF FOR 2023=====================

// --------------------------
// Load Satellite data (L8)
//-------------------2023---------------------
var combinedL8 = combinerL8("2023");
//-------------------2021---------------------
var combined2021 = combinerL8("2021");

// -------------------------------------------
//Create training data (LANDSAT)
// -------------------------------------------
//****LANDSAT****
//-------------------2023---------------------
var trainImageL8 = combinedL8.sampleRegions({
   collection: shapefile,
   properties: [label],
   scale: 20,
   tileScale :16
});
print(trainImageL8.first());
//--------------------2021----------------------
var trainImage2021 = combined2021.sampleRegions({
   collection: shapefile2021,
   properties: [label],
   scale: 20,
   tileScale :16
});
//-----------------MERGE 2023+2021---------------
var trainImageMerge = trainImageL8.merge(trainImage2021);
//------------------------------------------------
var trainSetL8 = ee.FeatureCollection(trainImageMerge.filter(ee.Filter.eq(label,-1)));
var testSetL8 = ee.FeatureCollection(trainImageMerge.filter(ee.Filter.eq(label,-1)));
//-----------------------------------------------
var classes=[0,1,2,3,4,5,6,7,8,9,10,11,12];
// Avec cette technique on choisit 70% de chaque classe (sauf sol nu: 10%)
//===LANDSAT=========================================
var DDD= classes.map(function(classeL8) {
  var trainingSamplesL8 = trainImageMerge.filter(ee.Filter.eq(label,classeL8)).randomColumn();
  //  on choisit moins de parcelle de sol nu (10%)
  //sol nu =1
  var proportion1L8 =ee.Algorithms.If(ee.Number(classeL8).eq(1),0.1,0.7); 
  var proportion2L8 =ee.Algorithms.If(ee.Number(classeL8).eq(1),0.95,0.7);
  var thisTrainL8 =trainingSamplesL8.filter(ee.Filter.lessThan('random', proportion1L8));
  var thisTestL8 = trainingSamplesL8.filter(ee.Filter.greaterThanOrEquals('random', proportion2L8));
  trainSetL8 = trainSetL8.merge(thisTrainL8);
  testSetL8 = testSetL8.merge(thisTestL8);
  return(1);
  });

//*********************************************************************************
//===============================5. RANDOM FOREST TRAINING ========================
//*********************************************************************************

// -------------------------------------------
// Train and Test the Random Forest classifier
// -------------------------------------------
//****LANDSAT****
var classifierL8 = ee.Classifier.smileRandomForest(50).train({
  features: trainSetL8,
  classProperty: label,
  inputProperties: combinedL8.bandNames()
});
//var classifiedL8 = combinedL8.classify(classifierL8);

//*********************************************************************************
//===============================6. ACCURACY ASSESSMENT ===========================
//*********************************************************************************
// ------------------------------------------------
// METRICS
// ------------------------------------------------
//****LANDSAT****
var confusionMatrixL8  = classifierL8.confusionMatrix();
print('Confusion Matrix L8:',confusionMatrixL8);

// on applique le classifier sur la jeu de données de test
var testL8 = testSetL8.classify(classifierL8);
print(testL8.first());

var confusionMatrix2L8 = testL8.errorMatrix(label, 'classification');
print('Error Matrix L8:',confusionMatrix2L8);
print('Overall Accuracy L8:', confusionMatrix2L8.accuracy());
print('Producers Accuracy L8:', confusionMatrix2L8.producersAccuracy());
print('Consumers Accuracy L8:', confusionMatrix2L8.consumersAccuracy());
print(' Fscore L8:', confusionMatrix2L8.fscore());	
print('Kappa L8:',confusionMatrix2L8.kappa());

//*****************************************************************************************
//===============================7. CLASSIFICATION 2023--> 2000 ===========================
//*****************************************************************************************
//********************************************
// Classify the Landsat CompoImage
//********************************************
//===========LANDSAT========================================
var trainImageL8 = combinedL8.sampleRegions({
   collection: shapefile,
   properties: [label],
   scale: 20,  // xxxxxxxxxxxxxxxxx  passer à scale = 10 pour l'exportation xxxxxxxxxxxxxxxxxxxx
   tileScale :16
});

var classifierL8 = ee.Classifier.smileRandomForest(50).train({
  features: trainImageMerge,
  classProperty: label,
  inputProperties: combinedL8.bandNames()
});

print(classifierL8.explain(), 'Explain 2 L8:')
//-----------------------------------------------------------------
var importance = ee.Dictionary(classifierL8.explain().get('importance'))
var sum = importance.values().reduce(ee.Reducer.sum())

var relativeImportance = importance.map(function(key, val) {
   return (ee.Number(val).multiply(100)).divide(sum)
  })
print(relativeImportance, 'Relative Importance')

var importanceFc = ee.FeatureCollection([
  ee.Feature(null, relativeImportance)
])

var chart2 = ui.Chart.feature.byProperty({
  features: importanceFc
}).setOptions({
      title: 'RF Variable Importance - Method 2',
      vAxis: {title: 'Importance'},
      hAxis: {title: 'Bands'}
  })
print(chart2, 'Relative Importance')

//============================CLASSIF 2023,2016,2015,2014,2013,2012,2011,2010===========================================

//========LANDSAT-8==================================
print('====================2023===============');
var combinedL8 = combinerL8("2023");
var classified2023_L8 = combinedL8.unmask().classify(classifierL8);
var combinedL8 = combinerL8("2022");
var classified2022_L8 = combinedL8.unmask().classify(classifierL8);
var combinedL8 = combinerL8("2021");
var classified2021_L8 = combinedL8.unmask().classify(classifierL8);
var combinedL8 = combinerL8("2020");
var classified2020_L8 = combinedL8.unmask().classify(classifierL8);
var combinedL8 = combinerL8("2019");
var classified2019_L8 = combinedL8.unmask().classify(classifierL8);
var combinedL8 = combinerL8("2018");
var classified2018_L8 = combinedL8.unmask().classify(classifierL8);
var combinedL8 = combinerL8("2017");
var classified2017_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2016");
var classified2016_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2015");
var classified2015_L8 = combinedL8.classify(classifierL8);

//print("============= 2013 =================");
var combinedL8 = combinerL8("2014");
var classified2014_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2013");
var classified2013_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2012");
var classified2012_L8 = combinedL8.classify(classifierL8);
print("============= 2011 =================");
var combinedL8 = combinerL8("2011");
var classified2011_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2010");
var classified2010_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2009");
var classified2009_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2008");
var classified2008_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2007");
var classified2007_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2006");
var classified2006_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2005");
var classified2005_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2004");
var classified2004_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2003");
var classified2003_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2002");
var classified2002_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2001");
var classified2001_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("2000");
var classified2000_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("1999");
var classified1999_L8 = combinedL8.classify(classifierL8);
var combinedL8 = combinerL8("1998");
var classified1998_L8 = combinedL8.classify(classifierL8);

//*********************************************************************************
//===============================7. VISUALISATION ===========================
//*********************************************************************************

// Map the classified imageS==========================================
//Define visualization
var landcoverPalette = [
  'blue',
  'beige',
  'yellow',
  'green',
  'cyan',
  'red',
  'brown',
  'pink',
  'orange',
  'purple',
  'magenta',
  'black',
  'grey'
];


Map.addLayer(classified2023_L8.clip(refArea), {palette: landcoverPalette, min:0, max:12}, 'classification map 2023 L8')

var legend = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 15px'
  }
});

var legendTitle = ui.Label({
  value: 'Land Cover Classes',
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 4px 0',
    padding: '0'
  }
});
legend.add(legendTitle);

// Create and add the legend items
var legendLabels = ['Vigne', 'Sol nu', 'Petit Pois', 'Olivier', 'double-crop', 'Luzerne', 'Feve', 'Cereale', 'Agrume', 'Abricotier','Melon-Pasteque','Eau','Cereale-carte'];
var landpalette = ['blue', 'beige', 'yellow', 'green', 'cyan', 'red', 'brown', 'pink', 'orange', 'purple','magenta','black','grey'];

for (var i = 0; i < legendLabels.length; i++) {
  var color = landpalette[i];
  var labels = ui.Label({
    value: legendLabels[i],
    style: {
      fontWeight: 'bold',
      fontSize: '12px',
      margin: '0 0 4px 0',
      padding: '0 0 0 20px',
      color: 'black'
    }
  });
  

  var colorBox = ui.Label({
      style: {
        backgroundColor: color,
        padding: '5px',
        margin: '0'
      }
    });

  legend.add(ui.Panel([colorBox, labels]));
  }
Map.add(legend);


//*********************************************************************************
//============================8. EXPORT MAPS AS GEOTIFF ===========================
//*********************************************************************************

// Export the classified image as a GeoTIFF
//2023
Export.image.toDrive({
  image: classified2023_L8,
  description: 'classification_mapL8_2023new',
  scale: 30,
  region: refArea
});

Export.image.toDrive({
  image: classified2022_L8,
  description: 'classification_mapL8_2022new',
  scale: 30,
  region: refArea
});

//2016
Export.image.toDrive({
  image: classified2021_L8,
  description: 'classification_mapL8_2021new',
  scale: 30,
  region: refArea
});
//2015
Export.image.toDrive({
  image: classified2020_L8,
  description: 'classification_mapL8_2020new',
  scale: 30,
  region: refArea
});
//2014
Export.image.toDrive({
  image: classified2019_L8,
  description: 'classification_mapL8_2019new',
  scale: 30,
  region: refArea
});
//2013
Export.image.toDrive({
  image: classified2018_L8,
  description: 'classification_mapL8_2018new',
  scale: 30,
  region: refArea
});
//2012
Export.image.toDrive({
  image: classified2017_L8,
  description: 'classification_mapL8_2017new',
  scale: 30,
  region: refArea
});
Export.image.toDrive({
  image: classified2016_L8,
  description: 'classification_mapL8_2016new',
  scale: 30,
  region: refArea
});
Export.image.toDrive({
  image: classified2015_L8,
  description: 'classification_mapL8_2015new',
  scale: 30,
  region: refArea
});

//2011
Export.image.toDrive({
  image: classified2014_L8,
  description: 'classification_mapL8_2014new',
  scale: 30,
  region: refArea
});
Export.image.toDrive({
  image: classified2013_L8,
  description: 'classification_mapL8_2013new',
  scale: 30,
  region: refArea
});
Export.image.toDrive({
  image: classified2012_L8,
  description: 'classification_mapL8_2012new',
  scale: 30,
  region: refArea
});
Export.image.toDrive({
  image: classified2011_L8,
  description: 'classification_mapL8_2011new',
  scale: 30,
  region: refArea
});
//2010
Export.image.toDrive({
  image: classified2010_L8,
  description: 'classification_mapL8_2010new',
  scale: 30,
  region: refArea
});
//2009
Export.image.toDrive({
  image: classified2009_L8,
  description: 'classification_mapL8_2009new',
  scale: 30,
  region: refArea
});
//2008
Export.image.toDrive({
  image: classified2008_L8,
  description: 'classification_mapL8_2008new',
  scale: 30,
  region: refArea
});
//2007
Export.image.toDrive({
  image: classified2007_L8,
  description: 'classification_mapL8_2007new',
  scale: 30,
  region: refArea
});
//2006
Export.image.toDrive({
  image: classified2006_L8,
  description: 'classification_mapL8_2006new',
  scale: 30,
  region: refArea
});

//2005
Export.image.toDrive({
  image: classified2005_L8,
  description: 'classification_mapL8_2005new',
  scale: 30,
  region: refArea
});
//2004
Export.image.toDrive({
  image: classified2004_L8,
  description: 'classification_mapL8_2004new',
  scale: 30,
  region: refArea
});
//2003
Export.image.toDrive({
  image: classified2003_L8,
  description: 'classification_mapL8_2003new',
  scale: 30,
  region: refArea
});
//2002
Export.image.toDrive({
  image: classified2002_L8,
  description: 'classification_mapL8_2002new',
  scale: 30,
  region: refArea
});
//2001
Export.image.toDrive({
  image: classified2001_L8,
  description: 'classification_mapL8_2001new',
  scale: 30,
  region: refArea
});
//2000
Export.image.toDrive({
  image: classified2000_L8,
  description: 'classification_mapL8_2000new',
  scale: 30,
  region: refArea
});
//1999
Export.image.toDrive({
  image: classified1999_L8,
  description: 'classification_mapL8_1999new',
  scale: 30,
  region: refArea
});
//1998
Export.image.toDrive({
  image: classified1998_L8,
  description: 'classification_mapL8_1998new',
  scale: 30,
  region: refArea
});


//-----------------------------------------------------------------------------
// Extract tables of predicted labels from the classified image
var trainingSamplesWithPrediction = testSetL8.classify(classifierL8);

// Get the predicted labels as an array
var predictedLabels = trainingSamplesWithPrediction.aggregate_array('classification');

// Get the actual labels as an array
var actualLabels = testSetL8.aggregate_array(label);
// Create feature collections from the arrays of labels
var predictedFeatures = ee.FeatureCollection(predictedLabels.map(function(label) {
  return ee.Feature(null, { predicted: label });
}));

var actualFeatures = ee.FeatureCollection(actualLabels.map(function(label) {
  return ee.Feature(null, { actual: label });
}));

// Export the predicted labels and actual labels as CSV files
Export.table.toDrive({
  collection: predictedFeatures,
  description: 'predicted_labels_L8',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: actualFeatures,
  description: 'actual_labels_L8',
  fileFormat: 'CSV'
});

// Print the arrays of predicted labels and actual labels
print('Predicted Labels:', predictedLabels);
print('Actual Labels:', actualLabels);

//----------------------------------------------------------------------------
var outline = ee.Image().byte().paint({
  featureCollection: shapefile,
  color: 1,
  width: 3
});
Map.addLayer(outline, {palette: '000000'}, 'training plots'); //displaye training plots


var pasteque = shapefile.filter(ee.Filter.eq(label, 4));
var outline = ee.Image().byte().paint({
  featureCollection: pasteque,
  color: 1,
  width: 3
});
Map.addLayer(outline, {palette: 'FF0000'}, 'Pasteque');// display specific classes
Map.addLayer(perimetre,{palette: 'FF0000'}, 'abainou');


//-------------------------HISTOGRAM FOR TOTAL AREA COMPUTATION ----------------
//==============================================================================
// Function to calculate NDVI histogram for each image

/*
function ndviHistogram(image) {
  var histogramStats = image.reduceRegion({
    reducer: ee.Reducer.fixedHistogram({min:0, max: 0.12, steps: 10}),
    geometry: upstream,
    scale: 30
  });
  var histogram = ee.Array(histogramStats.get('classification')).toList()

  var keys = histogram.map(function(item) {
    // Keys need to be strings and canot contian decinals
    // format them as integers by multiplying them by 100
    return ee.Number(ee.List(item).get(0)).multiply(100).toInt().format('%02d')
  });
  var values = histogram.map(function(item) {
    return ee.List(item).get(1)
  })
  var histogramDict = ee.Dictionary.fromLists(keys, values)
    return ee.Feature(null, ee.Dictionary({
    'date': ee.Date(image.get('system:time_start')).format('YYYY-MM-dd'),
  }).combine(histogramDict));
  
}

// Map the histogram function over the Sentinel-2 collection
var ndviHistograms = ee.ImageCollection(classified2023_L8).map(ndviHistogram);

// Create a single FeatureCollection from the time series of histograms
var timeSeries = ee.FeatureCollection(ndviHistograms);

// Suitable for Export as CSV
print(timeSeries, 'histogram')

*/

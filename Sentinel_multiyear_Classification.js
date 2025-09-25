/*------------------------------------------------------------------
Authors : Ikram El Hazdour & Michel LePage (IRD/CESBIO)
Contact : ikram.el_hazdour@ird.fr
v0: April 16th 2023: first lines with Random Forest
v1.3: July 07, 2023 : Function for creating input sat data, and monthly combination, random forest, metrics 70/30%, classifications from 2017 to 2023 
*/

var do_interpo=false; // if this variable is true, the times series will be interpolated with Savitsky-Golay.
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

var shapefile2021 = ee.FeatureCollection('projects/ee-ielhazdourced/assets/shapefilesCollection/dataset16072023_oneclasse')
    .filterMetadata(label, 'not_equals', null); 
var perimetre = ee.FeatureCollection('projects/ee-ielhazdourced/assets/shapefilesCollection/PERIMETRE_abainou');
var listYears = ["2023"]; // years to process with Sentinel-2
//"2018","2019","2020","2021","2022","2023"
Map.setOptions("HYBRID");

//*********************************************************************************
//=======================1. CLOUD AND SHADOW MASKING==============================
//*********************************************************************************
  function maskClouds(img) {
    var clouds = ee.Image(img.get('cloud_mask')).select('probability');
    var isNotCloud = clouds.lt(MAX_CLOUD_PROBABILITY);
    return img.updateMask(isNotCloud);
  }
  
  function maskEdges(s2_img) {
    return s2_img.updateMask(
        s2_img.select('B8A').mask().updateMask(s2_img.select('B9').mask()));
  }
  
  function combiner(year) {
  // ----------------------
  // Sentinel-2 images are selected for the current year from january 1st to july 1st
  // Some bands are selected 
  // Some indicators are computed
  // if do_interpo is true, th savitzky-Golay smoothing is done.
  // the monthly mean of selected bands and indicators are computed and combinded into the output image
  // ------------------------

  var START_DATE = year + "-01-01";
  var END_DATE = year + "-11-01";

  /* Delete an image==========================================================
  //var filterdate = ee.Filter.or(ee.Filter.date(START_DATE,ee.Date('2023-05-20')),(ee.Filter.date(ee.Date('2023-05-22'),END_DATE)));
  
  /* Sentinel 2 image collection==============================================
  ===========================================================================*/
  var s2Sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(refArea)
    .filterDate("2023-01-01", "2023-11-01" )
    .map(maskEdges)
print(s2Sr, "total s2 images number 2023")
  // Filter clouds
  var s2Clouds = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY');

  // Join S2 SR with cloud probability dataset to add cloud mask.
  s2Sr = ee.Join.saveFirst('cloud_mask').apply({
    primary: s2Sr,
    secondary: s2Clouds,
    condition:
        ee.Filter.equals({leftField: 'system:index', rightField: 'system:index'})
  });
  
  s2Sr =ee.ImageCollection(s2Sr).map(maskClouds);
  // Add NDVI and EVI2 bands to the image collection

  var addIndices = function(image) {
    var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
    var evi2 = image.expression(
      '(2.5 * (NIR - Red)) / (NIR + 2.4 * Red + 1)',
      {
        'NIR': image.select('B8'),
        'Red': image.select('B4')
      }
    ).rename('EVI2');
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
    var ndre = image.normalizedDifference(['B6', 'B8']).rename('NDRE');
    return image.addBands([ndvi, evi2, ndwi,ndre]);
  };
  
  /* Apply index calculation to the image collection===========================
  ===========================================================================*/
  s2Sr = s2Sr.map(addIndices);
  print("s2sr",s2Sr);
  
  
  
  // After processing, you can analyze the cloud percentages
var cloudStats = s2Sr.aggregate_stats('cloud_percentage');
print('Cloud percentage statistics for the year', cloudStats);

// To get a time series of cloud percentages
var cloudPercentages = s2Sr.aggregate_array('cloud_percentage');
var dates = s2Sr.aggregate_array('system:time_start');
print('Time series of cloud percentages', dates, cloudPercentages);

// To visualize cloud percentage over time
var chart = ui.Chart.feature.byFeature(
  s2Sr.map(function(image) {
    return ee.Feature(null, {
      date: ee.Date(image.get('system:time_start')).format('Y-MM-dd'),
      cloud_percentage: image.get('cloud_percentage')
    });
  }),
  'date',
  'cloud_percentage'
).setChartType('LineChart')
 .setOptions({
   title: 'Cloud Percentage Over Time',
   hAxis: {title: 'Date'},
   vAxis: {title: 'Cloud Percentage (%)'},
   lineWidth: 1,
   pointSize: 3
 });
print(chart, "chart cloudyyy");



//*********************************************************************************
//===========================2.  INTERPOLATION ====================================
//*********************************************************************************

  if (do_interpo === true) {
   
    var oeel=require('users/OEEL/lib:loadAll');
    
    var s2Sr=oeel.ImageCollection.SavatskyGolayFilter(s2Sr,
            ee.Filter.maxDifference(1000*3600*24*30, 'system:time_start', null, 'system:time_start'),
            function(infromedImage,estimationImage){
              return ee.Image.constant(ee.Number(infromedImage.get('system:time_start'))
                .subtract(ee.Number(estimationImage.get('system:time_start'))));},
            3);
            
    // Display a time-series chart=====================================
    var chart = ui.Chart.image.series({
      imageCollection: s2Sr.select(['NDVI', 'd_0_NDVI']),
      region: geometry2,
      reducer: ee.Reducer.mean(),
      scale: 20
    }).setOptions({
          lineWidth: 1,
          title: 'NDVI Time Series '+year,
          interpolateNulls: false,
          vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 1}},
          hAxis: {title: '', format: 'YYYY-MM'},
          lineWidth: 1,
          pointSize: 4,
          series: {
            0: {color: '#66c2a4', lineDashStyle: [1, 1], pointSize: 2}, // Original NDVI
            1: {color: '#238b45', lineWidth: 2 }, // Smoothed NDVI
          },
    
        })
    print(chart);
    Map.addLayer(s2Sr.select(['d_0_NDVI','NDVI']), { bands: ['d_0_NDVI','NDVI'], min: 0, max: 1 }, 'NDVI sg '+year,false);
    
    s2Sr = s2Sr.select(['d_0_.*','NDVI','NDWI']);
    
    print('Savgol time series '+year, s2Sr);
 
    var bands = ['d_0_B2', 'd_0_B3', 'd_0_B4', 'd_0_B8A', 'd_0_B11', 'd_0_B12', 'd_0_NDVI', 'd_0_EVI2', 'd_0_NDWI'];
    //var bands = ['d_0_B2', 'd_0_B3', 'd_0_B4',  'd_0_B6','d_0_B8', 'd_0_B11', 'd_0_B12', 'd_0_NDVI']; 
    //var bands = ['d_0_B12','d_0_NDVI']; 
    var rgb = ['d_0_B8', 'd_0_B4', 'd_0_B3'];
    } // fin de la fonction l'interpolation
  else
  {
    var bands = ['B2', 'B3', 'B4', 'B8A', 'B11', 'B12','NDVI','EVI2','NDWI']; 
   // var bands = ['d_0_B2', 'd_0_B3', 'd_0_B4',  'd_0_B6','d_0_B8', 'd_0_B11', 'd_0_B12', 'd_0_NDVI','d_0_EVI2','d_0_NDWI']; 
   
    //var bands = ['B12','NDVI']; 
    var rgb = ['B8', 'B4', 'B3'];

  }
  
  //---------------------------------------------FIN-INTERPOLATION---------------------------------------------

  // display mean composites (winter & summer)

 /* var mean_jan =s2Sr.select(rgb).filterDate(year+'-01-01', year+'-02-01').mean();
  Map.addLayer(mean_jan, { bands: rgb, min: 0, max: 10000 }, 'Jan '+year,false);
  var mean_june =s2Sr.select(rgb).filterDate(year+'-06-01', year+'-07-01').mean();
  Map.addLayer(mean_june, { bands: rgb, min: 0, max: 10000 }, 'June '+year,false);

  // Export the compo image as a GeoTIFF
  Export.image.toDrive({
    image: mean_jan,
    description: 'mean_jan',
    scale: 10,
    region: refArea
  });
  
  Export.image.toDrive({
    image: mean_june,
    description: 'mean_june',
    scale: 10,
    region: refArea
  });
  
 /*
  
  /* Create median, maximum, and minimum composites from the image collections===================================
  =============================================================================================================*/
     
//*********************************************************************************
//===============================3. FEATURE STACK =================================
//*********************************************************************************
  var combined = ee.Image.cat([
    s2Sr.filterDate(year+"-01-01", year+"-02-15").select(bands).reduce('median', 8),
    s2Sr.filterDate(year+"-02-15", year+"-04-01").select(bands).reduce('median', 8),
    s2Sr.filterDate(year+"-04-01", year+"-05-15").select(bands).reduce('median', 8),
    s2Sr.filterDate(year+"-05-15", year+"-07-01").select(bands).reduce('median', 8),
    s2Sr.filterDate(year+"-07-01", year+"-08-15").select(bands).reduce('median', 8),
    s2Sr.filterDate(year+"-08-15", year+"-10-01").select(bands).reduce('median', 8),
    ]).toFloat();

  print("====Combined "+ year, combined);

  return(combined);
  } // fin de la fonction combiner()


//*********************************************************************************
//=============================== 4. SAMPLING =====================================
//*********************************************************************************

//================CLASSIF FOR 2023=====================

// -------------------
// Load Satellite data
// -------2023------------
var combined = combiner("2023");
// -------2021------------
var combined2021 = combiner("2021");
//EXPORT COMBINED ===========================
/*Export.image.toDrive({
  image: combined,
  description: 'combined',
  scale: 10,
  region: refArea
});
*/
// -------------------
//Create training data (SENTINEL-2)
// -------------------
//===SENTINEL-2===============================
//-----------2023---------------------
var trainImage = combined.sampleRegions({
   collection: shapefile,
   properties: [label],
   scale: 20,
   tileScale :16
});
print(trainImage.first());
//-----------------2021---------------
var trainImage2021 = combined2021.sampleRegions({
   collection: shapefile2021,
   properties: [label],
   scale: 20,
   tileScale :16
});
//----------------MERGE 2023+2021-------------------------
var trainImageMerge = trainImage.merge(trainImage2021);
//------------------TRAIN---------------------------------
var trainSet = ee.FeatureCollection(trainImageMerge.filter(ee.Filter.eq(label,-1)));
var testSet = ee.FeatureCollection(trainImageMerge.filter(ee.Filter.eq(label,-1)));

var classes=[0,1,2,3,4,5,6,7,8,9,10,11,12];
//===SENTINEL-2==========================================
// Avec cette technique on choisit 70% de chaque classe (sauf sol nu: 10%)
var ttt= classes.map(function(classe) {
  var trainingSamples1 = trainImageMerge.filter(ee.Filter.eq(label,classe)).randomColumn();
  //  on choisit moins de parcelle de sol nu (10%)
  //sol nu =1
  var proportion1 =ee.Algorithms.If(ee.Number(classe).eq(1),0.1,0.7); 
  var proportion2 =ee.Algorithms.If(ee.Number(classe).eq(1),0.95,0.7);
  var thisTrain =trainingSamples1.filter(ee.Filter.lessThan('random', proportion1));
  var thisTest = trainingSamples1.filter(ee.Filter.greaterThanOrEquals('random', proportion2));
  trainSet = trainSet.merge(thisTrain);
  testSet = testSet.merge(thisTest);
  return(1);
  });



//*********************************************************************************
//===============================5. RANDOM FOREST TRAINING ========================
//*********************************************************************************

// -------------------------------------------
// Train and Test the Random Forest classifier
// -------------------------------------------
//===SENTINEL-2===========================================

var classifier = ee.Classifier.smileRandomForest(50).train({
  features: trainSet,
  classProperty: label,
  inputProperties: combined.bandNames()
});

print('==classifier', classifier);
//var classified = combined.classify(classifier);

//*********************************************************************************
//===============================6. ACCURACY ASSESSMENT ===========================
//*********************************************************************************

//=========================================================
// ------------------------------------------------
//                      METRICS
// ------------------------------------------------
//=======SENTINEL-2============================================
var confusionMatrix  = classifier.confusionMatrix();
print(confusionMatrix);

// on applique le classifier sur la jeu de données de test
var test = testSet.classify(classifier);
print(test.first());

var confusionMatrix2 = test.errorMatrix(label, 'classification');
print('ErroMatrix:',confusionMatrix2);
print('Overall Accuracy:', confusionMatrix2.accuracy());
print('Producers Accuracy:', confusionMatrix2.producersAccuracy());
print('Consumers Accuracy:', confusionMatrix2.consumersAccuracy());	
print(' Fscore:', confusionMatrix2.fscore());	
print('Kappa:',confusionMatrix2.kappa());

//********************************************
// Classify the Sentinel CompoImage
//********************************************
var trainImage = combined.sampleRegions({
   collection: shapefile,
   properties: [label],
   scale: 20,  // xxxxxxxxxxxxxxxxx  passer à scale = 10 pour l'exportation xxxxxxxxxxxxxxxxxxxx
   tileScale :16
});



var classifier = ee.Classifier.smileRandomForest(50).train({
  features: trainImageMerge,
  classProperty: label,
  inputProperties: combined.bandNames()
});

print(classifier.explain(), 'Explain 2:')

//----------------------------RELATIVE IMPORTANCE -------------------------------------
var importance = ee.Dictionary(classifier.explain().get('importance'))
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


//*****************************************************************************************
//===============================7. CLASSIFICATION 2023--> 2017 ===========================
//*****************************************************************************************

//============================CLASSIF 2023,2022,2021,2020,2019,2018,2017...===========================================
//=======SENTINEL-2==============================

var classified2023 = combined.classify(classifier);

var combined = combiner("2022");
var classified2022 = combined.classify(classifier);
var combined = combiner("2021");
var classified2021 = combined.classify(classifier);
var combined = combiner("2020");
var classified2020 = combined.classify(classifier);
var combined = combiner("2019");
var classified2019 = combined.classify(classifier);
var combined = combiner("2018");
var classified2018 = combined.classify(classifier);
/*var combined = combiner("2017");
var classified2017 = combined.classify(classifier);
*/

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
Map.addLayer(classified2023, {palette: landcoverPalette, min:0, max:12}, 'classification map 2023');


//------------------------------------------------------------------------------------------
// Define the legend
var legend = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 15px'
  }
});

// Create and add the legend title
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
var legendLabels = ['Vigne', 'Sol nu', 'Petit Pois', 'Olivier', 'double-crop', 'Luzerne', 'Feve', 'Cereale', 'Agrume', 'Abricotier','Melon-Pasteque','Eau', 'Cereale-carte'];
var landpalette = ['blue', 'beige', 'yellow', 'green', 'cyan', 'red', 'brown', 'pink', 'orange', 'purple','magenta','black','grey'];

// Add legend entries
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
  
  // Create and style the colored box for each legend entry
  var colorBox = ui.Label({
      style: {
        backgroundColor: color,
        padding: '5px',
        margin: '0'
      }
    });
  

  // Add the label and colored box to the legend
  legend.add(ui.Panel([colorBox, labels]));
  }

// Add legend to the map
Map.add(legend);



//*********************************************************************************
//============================8. EXPORT MAPS AS GEOTIFF ===========================
//*********************************************************************************
//--------------------------------------------------------------------------------------
// Export the classified image as a GeoTIFF
//2023
Export.image.toDrive({
  image: classified2023,
  description: 'classification_map_2023_new',
  scale: 10,
  region: refArea
});
//2022
Export.image.toDrive({
  image: classified2022,
  description: 'classification_map_2022_new',
  scale: 10,
  region: refArea
});
//2021
Export.image.toDrive({
  image: classified2021,
  description: 'classification_map_2021_new',
  scale: 10,
  region: refArea
});
//2020
Export.image.toDrive({
  image: classified2020,
  description: 'classification_map_2020_new',
  scale: 10,
  region: refArea
});
//2019
Export.image.toDrive({
  image: classified2019,
  description: 'classification_map_2019_new',
  scale: 10,
  region: refArea
});
//2018
Export.image.toDrive({
  image: classified2018,
  description: 'classification_map_2018_new',
  scale: 10,
  region: refArea
});

//2017---------pas de donnees S2B :(
//***********************************************888
//-----------------------------------------------------------------------------
// Extract tables of predicted labels from the classified image
var trainingSamplesWithPrediction = testSet.classify(classifier);

// Get the predicted labels as an array
var predictedLabels = trainingSamplesWithPrediction.aggregate_array('classification');

// Get the actual labels as an array
var actualLabels = testSet.aggregate_array(label);
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
  description: 'predicted_labels_S2',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: actualFeatures,
  description: 'actual_labels_S2',
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

//-------------------------------------------------------------


